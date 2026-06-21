"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from "lucide-react";
import type {
  UnifiedEvalResult,
  EvalItem,
  MetricBucket,
  RetrievedMemory,
  RetrievalData,
  ScoreDebug,
  KeyFact,
} from "@/lib/schema";

interface Props {
  runId: string;
  runStatus?: string;
}

export function ResultsView({ runId, runStatus }: Props) {
  const [data, setData] = useState<UnifiedEvalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showEvals, setShowEvals] = useState(false);
  const [filterGroup, setFilterGroup] = useState("all");
  const [filterVerdict, setFilterVerdict] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const isRunning = runStatus === "running";

  const fetchResults = useCallback(() => {
    return fetch(`/api/runs/${runId}/results`)
      .then((res) => {
        if (!res.ok) throw new Error("No results available yet");
        return res.json();
      })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((err) => {
        if (!isRunning) {
          setError(err instanceof Error ? err.message : "Failed");
        }
      });
  }, [runId, isRunning]);

  useEffect(() => {
    setLoading(true);
    fetchResults().finally(() => setLoading(false));
  }, [fetchResults]);

  // Auto-refresh while running
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(fetchResults, 5000);
    return () => clearInterval(interval);
  }, [isRunning, fetchResults]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-20 skeleton" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !isRunning) {
    return <p className="text-sm text-neutral-400">{error}</p>;
  }

  if (!data && isRunning) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse-soft" />
        <span className="text-sm text-blue-700">
          Waiting for results... (auto-refreshing)
        </span>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-neutral-400">No results available.</p>;
  }

  const { metadata, metrics, evaluations } = data;
  const groups = Object.keys(metrics.by_group ?? {});

  const filtered = evaluations.filter((ev) => {
    if (filterGroup !== "all" && ev.group !== filterGroup) return false;
    if (filterVerdict !== "all") {
      if (filterVerdict === "correct" && ev.judgment?.verdict !== "correct")
        return false;
      if (filterVerdict === "incorrect" && ev.judgment?.verdict !== "incorrect")
        return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <Chip>{metadata.eval_type}</Chip>
        {metadata.models?.answerer && (
          <Chip muted>Answerer: {metadata.models.answerer}</Chip>
        )}
        {metadata.models?.judge && (
          <Chip muted>Judge: {metadata.models.judge}</Chip>
        )}
        {metadata.dataset && (
          <Chip muted>{metadata.dataset.total_items} items</Chip>
        )}
      </div>

      {/* Overall metrics */}
      <Section title="Overall">
        <MetricCards bucket={metrics.overall} />
      </Section>

      {/* By group */}
      {groups.length > 0 && metrics.by_group && (
        <Section
          title={`By ${
            metadata.eval_type === "locomo"
              ? "Category"
              : metadata.eval_type === "longmemeval"
                ? "Question Type"
                : "Domain"
          }`}
        >
          <GroupTable groups={metrics.by_group} />
        </Section>
      )}

      {/* Multi-cutoff */}
      {metrics.by_cutoff && Object.keys(metrics.by_cutoff).length > 1 && (
        <Section title="By Top-K Cutoff">
          <CutoffTable cutoffs={metrics.by_cutoff} />
        </Section>
      )}

      {/* Evaluations */}
      <div>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Evaluations ({filtered.length})
          </h4>
          <FilterSelect
            value={filterGroup}
            onChange={(v) => {
              setFilterGroup(v);
              setPage(0);
            }}
          >
            <option value="all">All groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            value={filterVerdict}
            onChange={(v) => {
              setFilterVerdict(v);
              setPage(0);
            }}
          >
            <option value="all">All verdicts</option>
            <option value="correct">Correct</option>
            <option value="incorrect">Incorrect</option>
          </FilterSelect>
          {!showEvals && (
            <button
              onClick={() => setShowEvals(true)}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
            >
              Show evaluations
            </button>
          )}
        </div>

        {showEvals && (
          <>
            <div className="space-y-2 max-h-[65vh] overflow-auto">
              {paged.map((ev) => (
                <EvalItemCard
                  key={ev.id}
                  item={ev}
                  expanded={expandedId === ev.id}
                  onToggle={() =>
                    setExpandedId(expandedId === ev.id ? null : ev.id)
                  }
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-200">
                <span className="text-xs text-neutral-400">
                  {page * PAGE_SIZE + 1}&ndash;
                  {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{" "}
                  {filtered.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage(0)}
                    disabled={page === 0}
                    className="px-2 py-1 rounded text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 0}
                    className="px-2 py-1 rounded text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Prev
                  </button>
                  <span className="px-2 py-1 text-xs text-neutral-400 font-mono tabular-nums">
                    {page + 1}/{totalPages}
                  </span>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 rounded text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setPage(totalPages - 1)}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 rounded text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---- Section wrapper ----

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">
        {title}
      </h4>
      {children}
    </div>
  );
}

// ---- Chip ----

function Chip({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
        muted
          ? "text-neutral-500 bg-neutral-50"
          : "bg-indigo-50 text-indigo-700 font-mono"
      }`}
    >
      {children}
    </span>
  );
}

// ---- Filter Select ----

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white border border-neutral-200 rounded-md px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-400"
    >
      {children}
    </select>
  );
}

// ---- Metric Cards ----

function MetricCards({ bucket }: { bucket: MetricBucket }) {
  const cards: { label: string; value: string | number; accent?: string }[] = [
    { label: "Total", value: bucket.total },
    { label: "Passed", value: bucket.passed, accent: "text-emerald-600" },
    { label: "Failed", value: bucket.failed, accent: "text-rose-600" },
    {
      label: "Accuracy",
      value: `${bucket.accuracy.toFixed(1)}%`,
      accent:
        bucket.accuracy >= 70
          ? "text-emerald-600"
          : bucket.accuracy >= 50
            ? "text-amber-600"
            : "text-rose-600",
    },
  ];
  if (bucket.avg_score !== undefined) {
    cards.push({ label: "Avg Score", value: bucket.avg_score.toFixed(2) });
  }
  if (bucket.avg_search_latency_ms !== undefined) {
    cards.push({
      label: "Avg Search",
      value: `${(bucket.avg_search_latency_ms / 1000).toFixed(2)}s`,
    });
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-neutral-200 bg-white p-4"
        >
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
            {c.label}
          </div>
          <div
            className={`text-2xl font-semibold mt-1.5 tabular-nums ${c.accent ?? "text-neutral-900"}`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Group Table ----

function GroupTable({ groups }: { groups: Record<string, MetricBucket> }) {
  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-neutral-50">
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Group
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Total
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Passed
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Accuracy
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider w-44">
              Distribution
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(groups).map(([name, m]) => (
            <tr
              key={name}
              className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors duration-100"
            >
              <td className="px-4 py-3 font-medium text-[13px] text-neutral-900">
                {name}
              </td>
              <td className="px-4 py-3 tabular-nums text-neutral-600">
                {m.total}
              </td>
              <td className="px-4 py-3 tabular-nums text-neutral-600">
                {m.passed}
              </td>
              <td className="px-4 py-3">
                <AccuracyBadge value={m.accuracy} />
              </td>
              <td className="px-4 py-3">
                <BarChart value={m.accuracy} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Cutoff Table ----

function CutoffTable({
  cutoffs,
}: {
  cutoffs: Record<
    string,
    { overall: MetricBucket; by_group?: Record<string, MetricBucket> }
  >;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-neutral-50">
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Cutoff
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Total
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Passed
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Accuracy
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(cutoffs).map(([name, c]) => (
            <tr
              key={name}
              className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors duration-100"
            >
              <td className="px-4 py-3 font-mono text-[13px] text-neutral-900">
                {name}
              </td>
              <td className="px-4 py-3 tabular-nums text-neutral-600">
                {c.overall.total}
              </td>
              <td className="px-4 py-3 tabular-nums text-neutral-600">
                {c.overall.passed}
              </td>
              <td className="px-4 py-3">
                <AccuracyBadge value={c.overall.accuracy} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Eval Item Card ----

function EvalItemCard({
  item,
  expanded,
  onToggle,
}: {
  item: EvalItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const verdict = item.judgment?.verdict;
  const isCorrect = verdict === "correct";
  const retrieval = item.retrieval;

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors duration-150 ${
        expanded
          ? "border-neutral-300 bg-white"
          : "border-neutral-200 hover:border-neutral-300"
      }`}
    >
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-100"
      >
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${
            isCorrect
              ? "bg-emerald-500"
              : verdict === "error"
                ? "bg-amber-500"
                : "bg-rose-500"
          }`}
        />
        <span className="text-[13px] text-neutral-900 flex-1 truncate">
          {item.question}
        </span>
        {item.conversation_label && (
          <span className="text-[10px] text-neutral-400 shrink-0 px-1.5 py-0.5 rounded bg-neutral-100">
            {item.conversation_label}
          </span>
        )}
        <span className="text-[11px] text-neutral-400 shrink-0 font-mono">
          {item.group}
        </span>
        {item.judgment && (
          <span
            className={`text-[11px] font-medium shrink-0 px-2 py-0.5 rounded-full ${
              isCorrect
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
            }`}
          >
            {verdict}
            {item.judgment.score !== undefined &&
            item.judgment.score !== 1 &&
            item.judgment.score !== 0
              ? ` ${(item.judgment.score * 100).toFixed(0)}%`
              : ""}
          </span>
        )}
        {expanded ? (
          <ChevronDown size={14} className="text-neutral-400" />
        ) : (
          <ChevronRight size={14} className="text-neutral-400" />
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-neutral-200 animate-in">
          {/* Ground truth + generated answer */}
          <div className="p-4 space-y-3">
            <DetailRow label="Ground Truth" value={item.ground_truth} />
            {item.generation && (
              <DetailRow
                label="Generated Answer"
                value={item.generation.answer}
                variant={isCorrect ? "success" : "error"}
              />
            )}
          </div>

          {/* Retrieval */}
          {retrieval && (
            <div className="border-t border-neutral-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <SectionLabel>
                  Retrieved Memories ({retrieval.total_results})
                </SectionLabel>
                {retrieval.latency_ms !== undefined && (
                  <span className="text-[11px] text-neutral-400 font-mono">
                    {retrieval.latency_ms.toFixed(0)}ms
                  </span>
                )}
              </div>
              <div className="space-y-1 max-h-[400px] overflow-auto">
                {retrieval.results.map((mem) => (
                  <MemoryRow
                    key={`${mem.rank}-${mem.id ?? mem.memory.slice(0, 20)}`}
                    memory={mem}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Judgment */}
          {item.judgment &&
            (item.judgment.reasoning || item.judgment.key_facts) && (
              <div className="border-t border-neutral-200 p-4">
                <SectionLabel>Judgment</SectionLabel>
                {item.judgment.reasoning && (
                  <p className="text-[13px] text-neutral-600 whitespace-pre-wrap mt-2 leading-relaxed">
                    {item.judgment.reasoning}
                  </p>
                )}
                {item.judgment.key_facts &&
                  item.judgment.key_facts.length > 0 && (
                    <div className="space-y-1.5 mt-3">
                      {item.judgment.key_facts.map((kf, i) => (
                        <KeyFactRow key={i} fact={kf} />
                      ))}
                    </div>
                  )}
              </div>
            )}

          {/* No data hint */}
          {!retrieval && !item.judgment?.reasoning && (
            <div className="px-4 pb-3 text-xs text-neutral-400">
              No detailed data available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Primitives ----

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
      {children}
    </span>
  );
}

function DetailRow({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: "success" | "error";
}) {
  const color =
    variant === "success"
      ? "text-emerald-700"
      : variant === "error"
        ? "text-rose-700"
        : "text-neutral-900";
  return (
    <div>
      <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
        {label}
      </span>
      <p className={`text-[13px] mt-1 leading-relaxed ${color}`}>{value}</p>
    </div>
  );
}

function MemoryRow({ memory }: { memory: RetrievedMemory }) {
  const [showDebug, setShowDebug] = useState(false);
  const hasDebug = !!memory.score_debug;

  return (
    <div className="rounded-md bg-neutral-50 group">
      <div className="flex gap-2.5 text-xs px-3 py-2 items-start">
        <span className="shrink-0 w-6 text-right text-neutral-400 font-mono tabular-nums pt-0.5">
          #{memory.rank}
        </span>
        <p className="flex-1 text-neutral-700 leading-relaxed">
          {memory.memory}
        </p>
        <span className="shrink-0 text-neutral-400 font-mono tabular-nums">
          {memory.score.toFixed(3)}
        </span>
        {hasDebug && (
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="shrink-0 text-neutral-400 hover:text-indigo-600 transition-colors"
            title="Score breakdown"
          >
            {showDebug ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        )}
      </div>
      {showDebug && memory.score_debug && (
        <div className="px-3 pb-2 ml-[34px]">
          <ScoreBreakdown debug={memory.score_debug} />
        </div>
      )}
    </div>
  );
}

function KeyFactRow({ fact }: { fact: KeyFact }) {
  const styles =
    fact.status === "supported"
      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
      : fact.status === "wrong"
        ? "bg-rose-50 border-rose-200 text-rose-700"
        : "bg-amber-50 border-amber-200 text-amber-700";
  return (
    <div className={`text-xs px-3 py-2 rounded-md border ${styles}`}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {fact.status}
        </span>
        <span className="text-neutral-700">{fact.fact}</span>
      </div>
      {fact.evidence && (
        <p className="text-neutral-500 mt-1 ml-4 text-[11px]">
          {fact.evidence}
        </p>
      )}
    </div>
  );
}

function ScoreBreakdown({ debug }: { debug: ScoreDebug }) {
  const isRRF = debug.rrf_score !== undefined;

  if (isRRF) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-neutral-500 uppercase tracking-wider font-medium">
            RRF Mode
          </span>
          <span className="font-mono text-neutral-600">
            rrf: {debug.rrf_score?.toFixed(4)}
          </span>
          {debug.final_rank !== undefined && (
            <span className="font-mono text-neutral-400">
              rank #{debug.final_rank}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          {debug.in_vector !== undefined && (
            <span
              className={`font-mono ${debug.in_vector ? "text-blue-600" : "text-neutral-400"}`}
            >
              vector: {debug.in_vector ? "yes" : "no"}
              {debug.vector_sim !== undefined &&
                ` (sim: ${debug.vector_sim.toFixed(3)})`}
              {debug.vector_rank !== undefined && ` #${debug.vector_rank}`}
            </span>
          )}
          {debug.in_bm25 !== undefined && (
            <span
              className={`font-mono ${debug.in_bm25 ? "text-amber-600" : "text-neutral-400"}`}
            >
              bm25: {debug.in_bm25 ? "yes" : "no"}
              {debug.bm25_rank !== undefined && ` #${debug.bm25_rank}`}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Combined/experimental mode
  const components: {
    key: string;
    value: number;
    color: string;
    label: string;
  }[] = [];
  if (debug.semantic_score !== undefined && debug.semantic_score > 0) {
    components.push({
      key: "semantic",
      value: debug.semantic_score,
      color: "bg-blue-500",
      label: "semantic",
    });
  }
  if (debug.bm25_score !== undefined && debug.bm25_score > 0) {
    components.push({
      key: "bm25",
      value: debug.bm25_score,
      color: "bg-amber-500",
      label: "bm25",
    });
  }
  if (debug.entity_boost !== undefined && debug.entity_boost > 0) {
    components.push({
      key: "entity",
      value: debug.entity_boost,
      color: "bg-purple-500",
      label: "entity",
    });
  }
  if (debug.lineage_boost !== undefined && debug.lineage_boost > 0) {
    components.push({
      key: "lineage",
      value: debug.lineage_boost,
      color: "bg-cyan-500",
      label: "lineage",
    });
  }

  const total = components.reduce((sum, c) => sum + c.value, 0);

  if (components.length === 0) {
    return (
      <div className="text-[10px] text-neutral-400 font-mono">
        {debug.combined_score !== undefined &&
          `combined: ${debug.combined_score.toFixed(3)}`}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="w-[200px] h-[5px] bg-neutral-200 rounded-full overflow-hidden flex">
          {components.map((c) => (
            <div
              key={c.key}
              className={`h-full ${c.color}`}
              style={{
                width: `${total > 0 ? (c.value / total) * 100 : 0}%`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {components.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 text-[10px] text-neutral-500"
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${c.color}`}
            />
            <span className="font-medium">{c.label}</span>
            <span className="font-mono">{c.value.toFixed(3)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function AccuracyBadge({ value }: { value: number }) {
  const color =
    value >= 70
      ? "text-emerald-600"
      : value >= 50
        ? "text-amber-600"
        : "text-rose-600";
  return (
    <span className={`font-medium tabular-nums ${color}`}>
      {value.toFixed(1)}%
    </span>
  );
}

function BarChart({ value }: { value: number }) {
  const color =
    value >= 70 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="w-full bg-neutral-100 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}
