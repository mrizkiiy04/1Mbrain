"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Plus, FlaskConical, Trash2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProgressInfo {
  percent: number;
  current: number;
  total: number;
  eta: string;
  label: string;
}

interface Run {
  id: string;
  template_id: string;
  template_name?: string;
  project_name: string;
  status: string;
  config: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  progress?: ProgressInfo | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(dateString: string | null): string {
  if (!dateString) return "\u2014";
  const diff = Date.now() - new Date(dateString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      new Date(dateString).getFullYear() !== new Date().getFullYear()
        ? "numeric"
        : undefined,
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function durationBetween(
  start: string | null,
  end: string | null,
): string | null {
  if (!start) return null;
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const seconds = (e - s) / 1000;
  if (seconds < 0) return null;
  return formatDuration(seconds);
}

function parseModel(configJson: string): string | null {
  try {
    const cfg = JSON.parse(configJson);
    return cfg.answerer_model || cfg.model || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [benchmarkFilter, setBenchmarkFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Fetch runs list */
  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      if (!res.ok) return;
      const data: Run[] = await res.json();

      /* For running runs, fetch individual endpoints to get progress */
      const runningIds = data.filter(
        (r) => r.status === "running" || r.status === "pending",
      );
      if (runningIds.length > 0) {
        const progressResults = await Promise.allSettled(
          runningIds.map((r) =>
            fetch(`/api/runs/${r.id}`).then((res) => res.json()),
          ),
        );
        const progressMap = new Map<string, ProgressInfo | null>();
        progressResults.forEach((result, i) => {
          if (result.status === "fulfilled" && result.value?.progress) {
            progressMap.set(runningIds[i].id, result.value.progress);
          }
        });
        for (const run of data) {
          if (progressMap.has(run.id)) {
            run.progress = progressMap.get(run.id);
          }
        }
      }

      setRuns(data);
    } catch {
      /* network error, skip */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    pollRef.current = setInterval(fetchRuns, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchRuns]);

  /* Derived data */
  const activeCount = runs.filter(
    (r) => r.status === "running" || r.status === "pending",
  ).length;
  const succeededCount = runs.filter((r) => r.status === "succeeded").length;
  const failedCount = runs.filter((r) => r.status === "failed").length;

  const benchmarks = Array.from(new Set(runs.map((r) => r.template_id))).sort();

  const filtered = runs.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (benchmarkFilter !== "all" && r.template_id !== benchmarkFilter)
      return false;
    return true;
  });

  /* Selection helpers */
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selected.size} run${selected.size > 1 ? "s" : ""}? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await fetch("/api/runs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      setSelected(new Set());
      await fetchRuns();
    } catch {
      /* ignore */
    } finally {
      setDeleting(false);
    }
  };

  /* ---- Loading skeleton ---- */
  if (loading) {
    return (
      <div className="animate-in">
        <div className="mb-6">
          <div className="h-6 w-20 skeleton" />
          <div className="h-4 w-72 skeleton mt-2" />
        </div>
        <div className="h-10 w-full skeleton mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 skeleton rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  /* ---- Empty state ---- */
  if (runs.length === 0) {
    return (
      <div className="animate-in">
        <div className="text-center py-20">
          <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center mx-auto mb-4">
            <FlaskConical size={24} className="text-neutral-400" />
          </div>
          <h3 className="text-sm font-medium text-neutral-900">
            No benchmark runs yet
          </h3>
          <p className="text-sm text-neutral-400 mt-1 max-w-sm mx-auto">
            Run your first benchmark to evaluate memory recall across standard
            datasets.
          </p>
          <Link
            href="/runs/new"
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800"
          >
            <Plus size={14} />
            Start first run
          </Link>
        </div>
      </div>
    );
  }

  /* ---- Main view ---- */
  return (
    <div className="animate-in">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          Runs
        </h1>
        <p className="text-sm text-neutral-400 mt-0.5 tabular-nums">
          {runs.length} total{" "}
          <span className="text-neutral-300 mx-0.5">&middot;</span>{" "}
          {activeCount} active{" "}
          <span className="text-neutral-300 mx-0.5">&middot;</span>{" "}
          {succeededCount} passed{" "}
          <span className="text-neutral-300 mx-0.5">&middot;</span>{" "}
          {failedCount} failed
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white border rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-400"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="stopped">Stopped</option>
        </select>

        <select
          value={benchmarkFilter}
          onChange={(e) => setBenchmarkFilter(e.target.value)}
          className="bg-white border rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-400"
        >
          <option value="all">All benchmarks</option>
          {benchmarks.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {selected.size > 0 && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors duration-150"
          >
            <Trash2 size={14} />
            {deleting
              ? "Deleting..."
              : `Delete ${selected.size} selected`}
          </button>
        )}
      </div>

      {/* Run cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-neutral-400">
            No runs match the current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((run) => {
            const model = parseModel(run.config);
            const isRunning =
              run.status === "running" || run.status === "pending";
            const isSelected = selected.has(run.id);

            return (
              <div
                key={run.id}
                className={`rounded-xl border bg-white p-4 transition-colors duration-150 group ${
                  isSelected
                    ? "border-indigo-300 bg-indigo-50/30"
                    : "hover:border-neutral-300"
                }`}
              >
                {/* Row 1: checkbox + project name + time ago */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(run.id)}
                    className="w-3.5 h-3.5 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer shrink-0"
                  />
                  <Link
                    href={`/runs/${run.id}`}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-neutral-900 text-sm truncate">
                        {run.project_name}
                      </span>
                      <span className="text-xs text-neutral-400 tabular-nums shrink-0 ml-3">
                        {timeAgo(run.started_at || run.created_at)}
                      </span>
                    </div>

                    {/* Row 2: benchmark badge + model */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] font-mono text-neutral-400 bg-neutral-100 rounded px-1.5 py-0.5">
                        {run.template_id}
                      </span>
                      {model && (
                        <span className="text-[11px] text-neutral-400">
                          {model}
                        </span>
                      )}
                    </div>

                    {/* Row 3: status badge + contextual info */}
                    <div className="flex items-center gap-2 mt-2">
                      <StatusBadge status={run.status} />

                      {run.status === "succeeded" && (
                        <span className="text-xs text-neutral-400">
                          Duration:{" "}
                          {durationBetween(run.started_at, run.finished_at) ||
                            "\u2014"}
                        </span>
                      )}
                      {run.status === "failed" && (
                        <span className="text-xs text-red-400">
                          Failed after{" "}
                          {durationBetween(run.started_at, run.finished_at) ||
                            "\u2014"}
                        </span>
                      )}
                      {run.status === "stopped" && (
                        <span className="text-xs text-neutral-400">
                          Stopped after{" "}
                          {durationBetween(run.started_at, run.finished_at) ||
                            "\u2014"}
                        </span>
                      )}
                    </div>

                    {/* Progress bar for running runs */}
                    {isRunning && run.progress && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                          <span>
                            {run.progress.current}/{run.progress.total}
                          </span>
                          <span>
                            {run.progress.percent}%
                            {run.progress.eta
                              ? ` \u00b7 ETA ${run.progress.eta}`
                              : ""}
                          </span>
                        </div>
                        <div className="w-full h-1 rounded-full bg-neutral-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                            style={{
                              width: `${run.progress.percent}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
