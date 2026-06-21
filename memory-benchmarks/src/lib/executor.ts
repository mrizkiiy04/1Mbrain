import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { updateRun, getRun, type EvalRun } from "./runs";
import type { EvalTemplate } from "./templates";

const REPO_ROOT = process.cwd();
const LOGS_DIR = path.join(REPO_ROOT, "logs");

// Track running processes in memory
const runningProcesses = new Map<string, ChildProcess>();

/** Check whether a run has an active in-memory process. */
export function isRunActive(runId: string): boolean {
  return runningProcesses.has(runId);
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Build a clean env for benchmark scripts.
 * Strips MEM0_* from inherited env so the .env file takes precedence,
 * then applies user overrides.
 */
function buildScriptEnv(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MEM0_") || value === undefined) continue;
    env[key] = value;
  }
  return { ...env, ...overrides } as NodeJS.ProcessEnv;
}

/**
 * Convert a config object into CLI arguments.
 * { max_workers: 10, debug: true } -> ["--max-workers", "10", "--debug"]
 */
function buildArgs(config: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (value === null || value === undefined || value === "" || value === false)
      continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const flag = `--${key.replace(/_/g, "-")}`;
    if (value === true) {
      args.push(flag);
    } else if (Array.isArray(value)) {
      args.push(flag, value.join(","));
    } else {
      args.push(flag, String(value));
    }
  }
  return args;
}

// --- Run lifecycle ---

export interface RunConfig {
  config: Record<string, unknown>;
  env_overrides: Record<string, string>;
}

export function startRun(
  runId: string,
  template: EvalTemplate,
  projectName: string,
  runConfig: RunConfig,
) {
  ensureLogsDir();
  const logFile = path.join(LOGS_DIR, `${runId}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  updateRun(runId, { log_file: logFile });

  const scriptPath = path.join(REPO_ROOT, template.script_path);
  const args = ["--project-name", projectName, ...buildArgs(runConfig.config)];

  const header =
    `[memory-benchmarks] Run: ${template.name}\n` +
    `Script: ${scriptPath}\n` +
    `Args: ${args.join(" ")}\n` +
    `Time: ${new Date().toISOString()}\n` +
    `${"=".repeat(60)}\n\n`;
  logStream.write(header);

  const proc = spawn("python3", [scriptPath, ...args], {
    cwd: REPO_ROOT,
    env: buildScriptEnv(runConfig.env_overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningProcesses.set(runId, proc);
  updateRun(runId, {
    status: "running",
    pid: proc.pid ?? null,
    started_at: new Date().toISOString(),
  });

  const log = (msg: string) => {
    if (!logStream.destroyed) logStream.write(msg);
  };

  let outputBuffer = "";
  let finished = false;

  const finish = (status: EvalRun["status"]) => {
    if (finished) return;
    finished = true;

    // Guard against race: if a newer process replaced us, don't touch state
    const currentProc = runningProcesses.get(runId);
    if (currentProc && currentProc !== proc) return;

    runningProcesses.delete(runId);
    logStream.end();

    // Don't overwrite "stopped" or "running" (restart) with "failed"
    const current = getRun(runId);
    if (current?.status === "stopped" || current?.status === "running") return;

    // Parse "Results saved to: <path>" from output to record result file
    const resultFileMatch = outputBuffer.match(/Results saved to:\s*(.+)/);
    let resultFile: string | undefined;
    if (resultFileMatch) {
      const raw = resultFileMatch[1].trim();
      resultFile = path.isAbsolute(raw) ? raw : path.join(REPO_ROOT, raw);
    }

    updateRun(runId, {
      status,
      finished_at: new Date().toISOString(),
      ...(resultFile ? { result_file: resultFile } : {}),
    });
  };

  proc.stdout?.on("data", (data: Buffer) => {
    const s = data.toString();
    outputBuffer += s;
    log(s);
  });
  proc.stderr?.on("data", (data: Buffer) => {
    const s = data.toString();
    outputBuffer += s;
    log(s);
  });

  proc.on("close", (code) => {
    log(
      `\n${"=".repeat(60)}\n[memory-benchmarks] Run finished with code ${code}\n`,
    );
    finish(code === 0 ? "succeeded" : "failed");
  });

  proc.on("error", (err) => {
    log(`\n[memory-benchmarks] Process error: ${err.message}\n`);
    finish("failed");
  });
}

export async function stopRun(runId: string): Promise<boolean> {
  const proc = runningProcesses.get(runId);
  const now = new Date().toISOString();

  if (proc) {
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (runningProcesses.has(runId)) {
        proc.kill("SIGKILL");
      }
    }, 30000);
  } else {
    // Process not in memory (e.g., after server restart).
    // Fall back to killing by PID from the database.
    const run = getRun(runId);
    if (!run?.pid) return false;

    try {
      process.kill(run.pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(run.pid!, 0); // check if still alive
          process.kill(run.pid!, "SIGKILL");
        } catch {
          /* already exited */
        }
      }, 30000);
    } catch {
      // PID doesn't exist -- process already exited
    }
  }

  updateRun(runId, { status: "stopped", finished_at: now });
  return true;
}

export async function restartRun(
  runId: string,
  template: EvalTemplate,
  projectName: string,
  runConfig: RunConfig,
): Promise<void> {
  // Stop existing process if running
  if (runningProcesses.has(runId) || getRun(runId)?.status === "running") {
    await stopRun(runId);
    // Small delay to let the process clean up
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Reset run state
  updateRun(runId, {
    status: "pending",
    pid: null,
    started_at: null,
    finished_at: null,
    result_file: null,
  });

  startRun(runId, template, projectName, runConfig);
}

// --- Progress parsing ---

export interface ProgressInfo {
  percent: number;
  current: number;
  total: number;
  eta: string;
  label: string;
}

/**
 * Parse tqdm progress from a log file.
 *
 * Handles both single-bar (evaluate) and multi-bar (parallel predict) scenarios:
 *   - Finds ALL unique tqdm bars by label
 *   - Takes the latest progress for each bar
 *   - Aggregates current/total across all bars
 *   - Computes ETA from wall-clock elapsed time
 */
export function getProgress(
  logFile: string,
  startedAt?: string | null,
): ProgressInfo | null {
  try {
    const fd = fs.openSync(logFile, "r");
    const stat = fs.fstatSync(fd);
    const readSize = Math.min(stat.size, 65536);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    let content = buffer.toString("utf-8");

    // Only parse tqdm bars from the current phase
    const lastHeader = content.lastIndexOf("[memory-benchmarks] Run:");
    if (lastHeader > 0) {
      content = content.substring(lastHeader);
    }

    // Find all tqdm progress lines and track latest per label
    const tqdmPattern =
      /([^|\r\n]*?)\s*(\d+)%\|[^|]*\|\s*(\d+)\/(\d+)\s*\[([^\]]*)\]/g;
    const barState = new Map<string, { current: number; total: number }>();

    let match: RegExpExecArray | null;
    while ((match = tqdmPattern.exec(content)) !== null) {
      const label = match[1].trim().replace(/:$/, "") || "Progress";
      const current = parseInt(match[3]);
      const total = parseInt(match[4]);
      barState.set(label, { current, total });
    }

    if (barState.size === 0) return null;

    let totalCurrent = 0;
    let totalTotal = 0;
    for (const { current, total } of barState.values()) {
      totalCurrent += current;
      totalTotal += total;
    }

    if (totalTotal === 0) return null;

    const percent = Math.round((totalCurrent / totalTotal) * 100);

    let label: string;
    if (barState.size === 1) {
      label = barState.keys().next().value!;
    } else {
      const completedBars = [...barState.values()].filter(
        (b) => b.current >= b.total,
      ).length;
      label = `${barState.size} tasks (${completedBars} done)`;
    }

    // Compute ETA from wall-clock time
    let eta = "";
    if (startedAt && totalCurrent > 0 && percent < 100) {
      const elapsedMs = Date.now() - new Date(startedAt).getTime();
      const rate = totalCurrent / elapsedMs;
      const remainingItems = totalTotal - totalCurrent;
      const remainingMs = remainingItems / rate;
      eta = formatEta(remainingMs);
    }

    return { percent, current: totalCurrent, total: totalTotal, eta, label };
  } catch {
    return null;
  }
}

function formatEta(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function getLogTail(logFile: string, lines = 200): string {
  try {
    const content = fs.readFileSync(logFile, "utf-8");
    // Process \r (carriage return) to simulate terminal behavior
    const processed = content.split("\n").map((line) => {
      if (!line.includes("\r")) return line;
      const segments = line.split("\r");
      return segments[segments.length - 1];
    });
    return processed.slice(-lines).join("\n");
  } catch {
    return "";
  }
}
