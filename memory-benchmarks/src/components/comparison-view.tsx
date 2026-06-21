"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";

// --- Types ---

interface RunInfo {
  id: string;
  project_name: string;
  template_id: string;
  config: Record<string, unknown>;
  started_at: string | null;
}

interface ConfigDiffItem {
  key: string;
  lever_name: string | null;
  value_a: unknown;
  value_b: unknown;
}

interface MetricBucket {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  accuracy: number;
  avg_score?: number;
}

interface FlipDetail {
  question_id: string;
  group: string;
  question: string;
  ground_truth: string;
  direction: "improvement" | "regression";
  verdict_a: string;
  verdict_b: string;
  score_a: number;
  score_b: number;
  retrieval_a: { memory: string; score: number }[];
  retrieval_b: { memory: string; score: number }[];
}

interface UnchangedDetail {
  question_id: string;
  group: string;
  question: string;
  verdict: string;
}

export interface ComparisonData {
  run_a: RunInfo;
  run_b: RunInfo;
  config_diff: ConfigDiffItem[];
  metrics: {
    run_a: {
      overall: MetricBucket;
      by_group: Record<string, MetricBucket>;
    };
    run_b: {
      overall: MetricBucket;
      by_group: Record<string, MetricBucket>;
    };
    delta: {
      overall: Record<string, number>;
      by_group: Record<string, Record<string, number>>;
    };
  };
  flips: {
    improvements: number;
    regressions: number;
    net: number;
    details: FlipDetail[];
  };
  unchanged: {
    correct: number;
    incorrect: number;
    details: UnchangedDetail[];
  };
}

interface Props {
  data: ComparisonData;
}

// --- Main Component ---

export function ComparisonView({ data }: Props) {
  const { run_a, run_b, config_diff, metrics, flips, unchanged } = data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Compare Runs
        </h1>
        <div className="flex items-center gap-3 mt-3">
          <RunChip run={run_a} label="A" />
          <ArrowRight size={16} className="text-neutral-300" />
          <RunChip run={run_b} label="B" />
        </div>
      </div>

      {/* Config Diff */}
      <SectionBlock title="Config Diff">
        {config_diff.length === 0 ? (
          <p className="text-sm text-neutral-400">Identical configuration</p>
        ) : (
          <div className="rounded-xl border border-neutral-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50">
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                    Key
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                    Run A
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                    Run B
                  </th>
                </tr>
              </thead>
              <tbody>
                {config_diff.map((d) => (
                  <tr
                    key={d.key}
                    className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors duration-100"
                  >
                    <td className="px-4 py-3 font-mono text-[13px] text-neutral-900">
                      {d.key}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-rose-600">
                      {formatValue(d.value_a)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-emerald-600">
                      {formatValue(d.value_b)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionBlock>

      {/* Metrics */}
      <SectionBlock title="Metrics">
        <MetricsTable
          metricsA={metrics.run_a}
          metricsB={metrics.run_b}
          delta={metrics.delta}
        />
      </SectionBlock>

      {/* Flips */}
      <SectionBlock title="Verdict Flips">
        <FlipsSection flips={flips} />
      </SectionBlock>

      {/* Unchanged */}
      <SectionBlock title="Unchanged">
        <UnchangedSection unchanged={unchanged} />
      </SectionBlock>
    </div>
  );
}

// --- Section ---

function SectionBlock({
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

// --- Run Chip ---

function RunChip({ run, label }: { run: RunInfo; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-neutral-200 bg-white">
      <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
        {label}
      </span>
      <span className="text-[13px] font-medium text-neutral-900">
        {run.project_name}
      </span>
      <span className="text-[11px] text-neutral-400 font-mono">
        {run.template_id}
      </span>
      {run.started_at && (
        <span className="text-[11px] text-neutral-400">
          {new Date(run.started_at).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

// --- Metrics Table ---

function MetricsTable({
  metricsA,
  metricsB,
  delta,
}: {
  metricsA: {
    overall: MetricBucket;
    by_group: Record<string, MetricBucket>;
  };
  metricsB: {
    overall: MetricBucket;
    by_group: Record<string, MetricBucket>;
  };
  delta: {
    overall: Record<string, number>;
    by_group: Record<string, Record<string, number>>;
  };
}) {
  const groups = Array.from(
    new Set([
      ...Object.keys(metricsA.by_group),
      ...Object.keys(metricsB.by_group),
    ])
  );

  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-neutral-50">
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Group
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Run A Accuracy
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Run B Accuracy
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Delta
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Run A Passed
            </th>
            <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Run B Passed
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Overall row */}
          <tr className="border-t border-neutral-100 bg-neutral-50/50">
            <td className="px-4 py-3 font-semibold text-[13px] text-neutral-900">
              Overall
            </td>
            <td className="px-4 py-3 tabular-nums text-neutral-700">
              {metricsA.overall.accuracy.toFixed(1)}%
            </td>
            <td className="px-4 py-3 tabular-nums text-neutral-700">
              {metricsB.overall.accuracy.toFixed(1)}%
            </td>
            <td className="px-4 py-3">
              <DeltaBadge value={delta.overall.accuracy} suffix="%" />
            </td>
            <td className="px-4 py-3 tabular-nums text-neutral-500">
              {metricsA.overall.passed}/{metricsA.overall.total}
            </td>
            <td className="px-4 py-3 tabular-nums text-neutral-500">
              {metricsB.overall.passed}/{metricsB.overall.total}
            </td>
          </tr>
          {/* Per-group rows */}
          {groups.map((group) => {
            const ga = metricsA.by_group[group];
            const gb = metricsB.by_group[group];
            const gd = delta.by_group[group];
            return (
              <tr
                key={group}
                className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors duration-100"
              >
                <td className="px-4 py-3 text-[13px] text-neutral-900">
                  {group}
                </td>
                <td className="px-4 py-3 tabular-nums text-neutral-700">
                  {ga ? `${ga.accuracy.toFixed(1)}%` : "\u2014"}
                </td>
                <td className="px-4 py-3 tabular-nums text-neutral-700">
                  {gb ? `${gb.accuracy.toFixed(1)}%` : "\u2014"}
                </td>
                <td className="px-4 py-3">
                  {gd ? (
                    <DeltaBadge value={gd.accuracy} suffix="%" />
                  ) : (
                    <span className="text-neutral-400">&mdash;</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-neutral-500">
                  {ga ? `${ga.passed}/${ga.total}` : "\u2014"}
                </td>
                <td className="px-4 py-3 tabular-nums text-neutral-500">
                  {gb ? `${gb.passed}/${gb.total}` : "\u2014"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Flips Section ---

function FlipsSection({ flips }: { flips: ComparisonData["flips"] }) {
  const [filter, setFilter] = useState<"all" | "regressions" | "improvements">(
    "all"
  );

  const regressions = flips.details.filter(
    (f) => f.direction === "regression"
  );
  const improvements = flips.details.filter(
    (f) => f.direction === "improvement"
  );

  const shown =
    filter === "regressions"
      ? regressions
      : filter === "improvements"
        ? improvements
        : flips.details;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-neutral-200 bg-white">
        <span className="text-emerald-600 font-medium text-sm">
          +{flips.improvements} improvements
        </span>
        <span className="text-rose-600 font-medium text-sm">
          -{flips.regressions} regressions
        </span>
        <span
          className={`font-semibold text-sm ${
            flips.net > 0
              ? "text-emerald-600"
              : flips.net < 0
                ? "text-rose-600"
                : "text-neutral-500"
          }`}
        >
          net: {flips.net > 0 ? "+" : ""}
          {flips.net}
        </span>
      </div>

      {/* Filter buttons */}
      <div className="flex items-center gap-1.5">
        {(["all", "regressions", "improvements"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
              filter === f
                ? "bg-indigo-50 text-indigo-700"
                : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            {f === "all"
              ? `All (${flips.details.length})`
              : f === "regressions"
                ? `Regressions (${regressions.length})`
                : `Improvements (${improvements.length})`}
          </button>
        ))}
      </div>

      {/* Flip cards */}
      {shown.length === 0 ? (
        <p className="text-sm text-neutral-400">No flips found.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((flip) => (
            <FlipCard key={flip.question_id} flip={flip} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Flip Card ---

function FlipCard({ flip }: { flip: FlipDetail }) {
  const [expanded, setExpanded] = useState(false);

  const isRegression = flip.direction === "regression";
  const borderColor = isRegression
    ? "border-rose-200"
    : "border-emerald-200";
  const bgHover = isRegression
    ? "hover:border-rose-300"
    : "hover:border-emerald-300";

  return (
    <div
      className={`rounded-lg border ${borderColor} ${bgHover} overflow-hidden transition-colors duration-150`}
    >
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-100"
      >
        <span
          className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${
            isRegression
              ? "bg-rose-50 text-rose-600"
              : "bg-emerald-50 text-emerald-600"
          }`}
        >
          {isRegression ? "\u2713\u2192\u2717" : "\u2717\u2192\u2713"}
        </span>
        <span className="text-[11px] text-neutral-400 font-mono shrink-0">
          {flip.question_id}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 shrink-0">
          {flip.group}
        </span>
        <span className="text-[13px] text-neutral-900 flex-1 truncate">
          {flip.question}
        </span>
        {expanded ? (
          <ChevronDown size={14} className="text-neutral-400" />
        ) : (
          <ChevronRight size={14} className="text-neutral-400" />
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-neutral-100 animate-in">
          {/* Ground truth */}
          <div className="p-4">
            <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
              Ground Truth
            </span>
            <p className="text-[13px] mt-1 leading-relaxed text-neutral-900">
              {flip.ground_truth}
            </p>
          </div>

          {/* Retrieval diff side-by-side */}
          <div className="border-t border-neutral-100 grid grid-cols-2 divide-x divide-neutral-100">
            {/* Run A */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                  A
                </span>
                <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
                  Retrieved ({flip.retrieval_a.length})
                </span>
                <VerdictPill verdict={flip.verdict_a} />
              </div>
              <div className="space-y-1">
                {flip.retrieval_a.length === 0 ? (
                  <p className="text-xs text-neutral-400">No memories</p>
                ) : (
                  flip.retrieval_a.map((m, i) => (
                    <SimpleMemoryRow
                      key={i}
                      rank={i + 1}
                      memory={m.memory}
                      score={m.score}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Run B */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                  B
                </span>
                <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
                  Retrieved ({flip.retrieval_b.length})
                </span>
                <VerdictPill verdict={flip.verdict_b} />
              </div>
              <div className="space-y-1">
                {flip.retrieval_b.length === 0 ? (
                  <p className="text-xs text-neutral-400">No memories</p>
                ) : (
                  flip.retrieval_b.map((m, i) => (
                    <SimpleMemoryRow
                      key={i}
                      rank={i + 1}
                      memory={m.memory}
                      score={m.score}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Unchanged Section ---

function UnchangedSection({
  unchanged,
}: {
  unchanged: ComparisonData["unchanged"];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-neutral-200 bg-white">
        <span className="text-emerald-600 font-medium text-sm">
          {unchanged.correct} correct
        </span>
        <span className="text-rose-600 font-medium text-sm">
          {unchanged.incorrect} incorrect
        </span>
        <span className="text-neutral-500 text-sm">
          {unchanged.correct + unchanged.incorrect} total unchanged
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-auto text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
        >
          {expanded ? "Hide" : "Show details"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 rounded-xl border border-neutral-200 overflow-hidden max-h-[50vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 sticky top-0">
                <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                  Question ID
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                  Group
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                  Question
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                  Verdict
                </th>
              </tr>
            </thead>
            <tbody>
              {unchanged.details.map((item) => (
                <tr
                  key={item.question_id}
                  className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors duration-100"
                >
                  <td className="px-4 py-2.5 font-mono text-[12px] text-neutral-400">
                    {item.question_id}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">
                      {item.group}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[13px] max-w-md truncate text-neutral-900">
                    {item.question}
                  </td>
                  <td className="px-4 py-2.5">
                    <VerdictPill verdict={item.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Primitives ---

function DeltaBadge({
  value,
  suffix = "",
}: {
  value: number;
  suffix?: string;
}) {
  if (value === 0)
    return (
      <span className="text-neutral-400 tabular-nums text-sm">
        0{suffix}
      </span>
    );
  const isPositive = value > 0;
  return (
    <span
      className={`font-medium tabular-nums text-sm ${isPositive ? "text-emerald-600" : "text-rose-600"}`}
    >
      {isPositive ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

function VerdictPill({ verdict }: { verdict: string }) {
  const isCorrect = verdict === "correct";
  return (
    <span
      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
        isCorrect
          ? "bg-emerald-50 text-emerald-700"
          : "bg-rose-50 text-rose-700"
      }`}
    >
      {verdict}
    </span>
  );
}

function SimpleMemoryRow({
  rank,
  memory,
  score,
}: {
  rank: number;
  memory: string;
  score: number;
}) {
  return (
    <div className="flex gap-2.5 text-xs px-3 py-2 rounded-md bg-neutral-50">
      <span className="shrink-0 w-5 text-right text-neutral-400 font-mono tabular-nums">
        #{rank}
      </span>
      <p className="flex-1 text-neutral-600 leading-relaxed">{memory}</p>
      <span className="shrink-0 text-neutral-400 font-mono tabular-nums">
        {score.toFixed(3)}
      </span>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "\u2014";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
