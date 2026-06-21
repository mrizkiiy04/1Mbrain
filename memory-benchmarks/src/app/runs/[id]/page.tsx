"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { StatusBadge } from "@/components/status-badge";
import { ResultsView } from "@/components/results-view";
import { ConversationsView } from "@/components/conversations-view";
import { ComparisonView, type ComparisonData } from "@/components/comparison-view";
import {
  ArrowLeft,
  Square,
  RotateCw,
  ArrowDown,
  Loader2,
  BarChart3,
  ScrollText,
  MessageSquare,
  GitCompareArrows,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Run {
  id: string;
  template_id: string;
  template_name?: string;
  project_name: string;
  status: string;
  config: string;
  env_overrides: string;
  pid: number | null;
  log_file: string | null;
  result_file: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  progress: {
    percent: number;
    current: number;
    total: number;
    eta: string;
    label: string;
  } | null;
}

interface ComparableRun {
  id: string;
  project_name: string;
  template_id: string;
  status: string;
  started_at: string | null;
}

type Tab = "results" | "logs" | "conversations" | "compare";

const tabMeta: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
  { key: "results", label: "Results", icon: BarChart3 },
  { key: "logs", label: "Logs", icon: ScrollText },
  { key: "conversations", label: "Conversations", icon: MessageSquare },
  { key: "compare", label: "Compare", icon: GitCompareArrows },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, Math.floor((now - then) / 1000));

  if (diff < 60) return "just now";
  if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return `${mins}m ago`;
  }
  if (diff < 86400) {
    const hrs = Math.floor(diff / 3600);
    return `${hrs}h ago`;
  }
  const days = Math.floor(diff / 86400);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState("");
  const [tab, setTab] = useState<Tab>("results");
  const [autoScroll, setAutoScroll] = useState(true);

  const logRef = useRef<HTMLPreElement>(null);
  const initialTabSet = useRef(false);
  const [pollTrigger, setPollTrigger] = useState(0);

  // Compare state
  const [comparableRuns, setComparableRuns] = useState<ComparableRun[]>([]);
  const [compareRunId, setCompareRunId] = useState("");
  const [compareData, setCompareData] = useState<ComparisonData | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [compareError, setCompareError] = useState("");

  /* ---- Fetch run + logs, poll while active ---- */

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchRunAndLogs = () => {
      fetch(`/api/runs/${id}`)
        .then((r) => r.json())
        .then((data: Run) => {
          setRun(data);

          // Smart default tab on first load
          if (!initialTabSet.current) {
            initialTabSet.current = true;
            if (data.status === "running" || data.status === "pending") {
              setTab("logs");
            } else if (data.status === "failed") {
              setTab("logs");
            } else {
              setTab("results");
            }
          }

          // Stop polling once terminal
          const active = data.status === "running" || data.status === "pending";
          if (!active && interval) {
            clearInterval(interval);
            interval = null;
          }
        });

      fetch(`/api/runs/${id}/logs`)
        .then((r) => r.text())
        .then(setLogs);
    };

    fetchRunAndLogs();
    interval = setInterval(fetchRunAndLogs, 2000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [id, pollTrigger]);

  /* ---- Auto-scroll logs ---- */

  useEffect(() => {
    if (logRef.current && autoScroll) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  /* ---- Fetch comparable runs when Compare tab is selected ---- */

  useEffect(() => {
    if (tab !== "compare" || !run) return;

    fetch("/api/runs")
      .then((r) => r.json())
      .then((runs: ComparableRun[]) => {
        const filtered = runs.filter(
          (r) =>
            r.id !== run.id &&
            r.template_id === run.template_id &&
            r.status === "succeeded"
        );
        setComparableRuns(filtered);
      });
  }, [tab, run]);

  /* ---- Fetch comparison data when a compare target is selected ---- */

  useEffect(() => {
    if (!compareRunId || !run) {
      setCompareData(null);
      setCompareError("");
      return;
    }

    setLoadingCompare(true);
    setCompareError("");

    fetch(`/api/compare?a=${run.id}&b=${compareRunId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: ComparisonData) => {
        setCompareData(data);
        setCompareError("");
      })
      .catch((err) => {
        setCompareError(err instanceof Error ? err.message : "Failed to load comparison");
        setCompareData(null);
      })
      .finally(() => setLoadingCompare(false));
  }, [compareRunId, run]);

  /* ---- Actions ---- */

  const handleStop = useCallback(async () => {
    await fetch(`/api/runs/${id}/stop`, { method: "POST" });
  }, [id]);

  const handleRestart = useCallback(async () => {
    const res = await fetch(`/api/runs/${id}/restart`, { method: "POST" });
    if (res.ok) {
      setPollTrigger((n) => n + 1);
      setTab("logs");
    }
  }, [id]);

  const scrollToBottom = useCallback(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  /* ---- Loading state ---- */

  if (!run) {
    return (
      <div className="space-y-4 animate-in">
        <div className="h-6 w-48 skeleton" />
        <div className="h-4 w-32 skeleton" />
        <div className="h-px bg-neutral-200 mt-6" />
        <div className="h-[400px] skeleton rounded-xl" />
      </div>
    );
  }

  /* ---- Derived state ---- */

  const duration =
    run.started_at && run.finished_at
      ? Math.round(
          (new Date(run.finished_at).getTime() -
            new Date(run.started_at).getTime()) /
            1000
        )
      : null;

  const isRunning = run.status === "running";
  const canRestart = run.status === "stopped" || run.status === "failed";

  /* ---- Render ---- */

  return (
    <div className="space-y-6 animate-in">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-600 mb-4"
      >
        <ArrowLeft size={14} />
        Runs
      </Link>

      {/* Run header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {run.project_name}
            </h1>
            <StatusBadge status={run.status} />
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[13px] text-neutral-400">
            <span className="font-mono text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded text-[11px]">
              {run.template_id}
            </span>
            <span>&middot;</span>
            <span>
              {duration !== null
                ? formatDuration(duration)
                : isRunning
                  ? "running..."
                  : "\u2014"}
            </span>
            {run.started_at && (
              <>
                <span>&middot;</span>
                <span>Started {timeAgo(run.started_at)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white border text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium"
            >
              <Square size={12} />
              Stop
            </button>
          )}
          {canRestart && (
            <button
              onClick={handleRestart}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg text-sm font-medium"
            >
              <RotateCw size={13} />
              Restart
            </button>
          )}
        </div>
      </div>

      {/* Progress bar (only when running with progress data) */}
      {isRunning && run.progress && (
        <div className="mt-4 rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-neutral-600 font-medium">
              {run.progress.label}: {run.progress.current}/{run.progress.total}
            </span>
            <span className="text-neutral-400 tabular-nums">
              {run.progress.percent}%
              {run.progress.eta ? ` \u00b7 ETA ${run.progress.eta}` : ""}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-500 ease-out"
              style={{ width: `${run.progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b mt-6">
        {tabMeta.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-all ${
              tab === key
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-400 hover:text-neutral-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Results (hidden but preserved) */}
      <div style={{ display: tab === "results" ? "block" : "none" }}>
        <ResultsView runId={run.id} runStatus={run.status} />
      </div>

      {/* Tab: Conversations (hidden but preserved) */}
      <div style={{ display: tab === "conversations" ? "block" : "none" }}>
        <ConversationsView runId={run.id} />
      </div>

      {/* Tab: Logs */}
      {tab === "logs" && (
        <div className="animate-in">
          <div className="rounded-xl border border-neutral-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-800/50">
              <span className="text-[11px] text-neutral-400 font-medium uppercase tracking-wider">
                Output
              </span>
              <div className="flex items-center gap-3">
                {isRunning && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-blue-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-soft" />
                    Live
                  </span>
                )}
                <button
                  onClick={scrollToBottom}
                  className="text-[11px] text-neutral-500 hover:text-neutral-300"
                >
                  <ArrowDown size={10} className="inline mr-1" />
                  Bottom
                </button>
              </div>
            </div>
            <pre
              ref={logRef}
              onScroll={() => {
                if (!logRef.current) return;
                const { scrollTop, scrollHeight, clientHeight } =
                  logRef.current;
                setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
              }}
              className="log-viewer p-4 text-xs font-mono overflow-auto max-h-[65vh] whitespace-pre-wrap leading-relaxed"
            >
              {logs || (
                <span className="text-neutral-500">No output yet...</span>
              )}
            </pre>
          </div>
        </div>
      )}

      {/* Tab: Compare */}
      {tab === "compare" && (
        <div className="space-y-4 animate-in">
          <div className="flex items-center gap-3">
            <label className="text-sm text-neutral-500">Compare with:</label>
            <select
              value={compareRunId}
              onChange={(e) => {
                setCompareRunId(e.target.value);
                setCompareData(null);
                setCompareError("");
              }}
              className="bg-white border rounded-lg px-3 py-1.5 text-sm min-w-[200px] focus:outline-none focus:border-indigo-400"
            >
              <option value="">Select a run...</option>
              {comparableRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.project_name}
                </option>
              ))}
            </select>
            {loadingCompare && (
              <Loader2 className="animate-spin text-neutral-400" size={16} />
            )}
          </div>

          {compareError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{compareError}</p>
            </div>
          )}

          {compareData && <ComparisonView data={compareData} />}

          {!compareRunId && !loadingCompare && (
            <p className="text-sm text-neutral-400 py-8 text-center">
              Select another run to compare results side by side.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
