import { getDb } from "./db";
import { seedTemplates } from "./templates";
import crypto from "crypto";

export interface EvalRun {
  id: string;
  template_id: string;
  project_name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "stopped";
  config: string;
  env_overrides: string;
  pid: number | null;
  log_file: string | null;
  result_file: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export function createRun(params: {
  template_id: string;
  project_name: string;
  config: Record<string, unknown>;
  env_overrides: Record<string, string>;
}): EvalRun {
  seedTemplates();
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO eval_runs (id, template_id, project_name, config, env_overrides)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    params.template_id,
    params.project_name,
    JSON.stringify(params.config),
    JSON.stringify(params.env_overrides),
  );
  return getRun(id)!;
}

export function getRun(id: string): EvalRun | undefined {
  seedTemplates();
  return getDb()
    .prepare("SELECT * FROM eval_runs WHERE id = ?")
    .get(id) as EvalRun | undefined;
}

export function listRuns(filters?: {
  status?: string;
  template_id?: string;
}): EvalRun[] {
  seedTemplates();
  let sql = "SELECT * FROM eval_runs WHERE 1=1";
  const params: unknown[] = [];
  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.template_id) {
    sql += " AND template_id = ?";
    params.push(filters.template_id);
  }
  sql += " ORDER BY created_at DESC";
  return getDb().prepare(sql).all(...params) as EvalRun[];
}

type UpdatableRunFields = Pick<
  EvalRun,
  "status" | "pid" | "log_file" | "result_file" | "started_at" | "finished_at"
>;

export function updateRun(id: string, updates: Partial<UpdatableRunFields>) {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE eval_runs SET ${sets.join(", ")} WHERE id = ?`).run(
    ...params,
  );
}

export function deleteRun(id: string) {
  deleteRuns([id]);
}

export function deleteRuns(ids: string[]) {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");

  // Get log files before deleting so we can clean them up
  const runs = db
    .prepare(`SELECT log_file FROM eval_runs WHERE id IN (${placeholders})`)
    .all(...ids) as { log_file: string | null }[];

  db.prepare(`DELETE FROM eval_runs WHERE id IN (${placeholders})`).run(
    ...ids,
  );

  // Clean up log files
  const fs = require("fs");
  for (const run of runs) {
    if (run.log_file) {
      try {
        fs.unlinkSync(run.log_file);
      } catch {
        /* already gone */
      }
    }
  }
}
