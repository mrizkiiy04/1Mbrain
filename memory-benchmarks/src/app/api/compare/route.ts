import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/runs";
import { normalize } from "@/lib/adapters";
import { readFileSync, existsSync } from "fs";
import type { UnifiedEvalResult, EvalItem, MetricBucket } from "@/lib/schema";

export const dynamic = "force-dynamic";

function loadResultForRun(run: {
  result_file: string | null;
  config: string;
}): UnifiedEvalResult | null {
  if (!run.result_file || !existsSync(run.result_file)) return null;
  const raw = JSON.parse(readFileSync(run.result_file, "utf-8"));

  let predictData: Record<string, unknown> | undefined;
  const config = JSON.parse(run.config);
  if (config.predict_file && existsSync(config.predict_file)) {
    predictData = JSON.parse(readFileSync(config.predict_file, "utf-8"));
  }

  return normalize(raw, predictData);
}

interface ConfigDiffItem {
  key: string;
  value_a: unknown;
  value_b: unknown;
}

function computeConfigDiff(
  configA: Record<string, unknown>,
  envA: Record<string, unknown>,
  configB: Record<string, unknown>,
  envB: Record<string, unknown>,
): ConfigDiffItem[] {
  const diffs: ConfigDiffItem[] = [];
  const mergedA = { ...configA, ...envA };
  const mergedB = { ...configB, ...envB };
  const allKeys = new Set([
    ...Object.keys(mergedA),
    ...Object.keys(mergedB),
  ]);

  for (const key of allKeys) {
    const vA = mergedA[key];
    const vB = mergedB[key];
    if (JSON.stringify(vA) !== JSON.stringify(vB)) {
      diffs.push({ key, value_a: vA ?? null, value_b: vB ?? null });
    }
  }

  return diffs;
}

function computeMetricDelta(
  a: MetricBucket,
  b: MetricBucket,
): Record<string, number> {
  const delta: Record<string, number> = {};
  delta.accuracy = Number((b.accuracy - a.accuracy).toFixed(2));
  delta.total = b.total - a.total;
  delta.passed = b.passed - a.passed;
  delta.failed = b.failed - a.failed;
  if (a.avg_score !== undefined && b.avg_score !== undefined) {
    delta.avg_score = Number((b.avg_score - a.avg_score).toFixed(4));
  }
  if (
    a.avg_search_latency_ms !== undefined &&
    b.avg_search_latency_ms !== undefined
  ) {
    delta.avg_search_latency_ms = Number(
      (b.avg_search_latency_ms - a.avg_search_latency_ms).toFixed(1),
    );
  }
  return delta;
}

interface FlipDetail {
  question_id: string;
  group: string;
  question: string;
  ground_truth: string;
  direction: "improvement" | "regression";
  verdict_a: "correct" | "incorrect" | "error";
  verdict_b: "correct" | "incorrect" | "error";
  score_a: number;
  score_b: number;
}

export function GET(req: NextRequest) {
  const a = req.nextUrl.searchParams.get("a");
  const b = req.nextUrl.searchParams.get("b");

  if (!a || !b) {
    return NextResponse.json(
      { error: "Both 'a' and 'b' query params required" },
      { status: 400 },
    );
  }

  const runA = getRun(a);
  const runB = getRun(b);

  if (!runA)
    return NextResponse.json(
      { error: `Run A not found: ${a}` },
      { status: 404 },
    );
  if (!runB)
    return NextResponse.json(
      { error: `Run B not found: ${b}` },
      { status: 404 },
    );

  if (runA.status !== "succeeded") {
    return NextResponse.json(
      { error: `Run A has not succeeded (status: ${runA.status})` },
      { status: 400 },
    );
  }
  if (runB.status !== "succeeded") {
    return NextResponse.json(
      { error: `Run B has not succeeded (status: ${runB.status})` },
      { status: 400 },
    );
  }

  const resultA = loadResultForRun(runA);
  const resultB = loadResultForRun(runB);

  if (!resultA)
    return NextResponse.json(
      { error: "No results for Run A" },
      { status: 400 },
    );
  if (!resultB)
    return NextResponse.json(
      { error: "No results for Run B" },
      { status: 400 },
    );

  // Config diff
  const parseJson = (s: string | null) => {
    if (!s) return {};
    try {
      return JSON.parse(s);
    } catch {
      return {};
    }
  };

  const configDiff = computeConfigDiff(
    parseJson(runA.config),
    parseJson(runA.env_overrides),
    parseJson(runB.config),
    parseJson(runB.env_overrides),
  );

  // Metric deltas
  const overallDelta = computeMetricDelta(
    resultA.metrics.overall,
    resultB.metrics.overall,
  );
  const allGroups = new Set([
    ...Object.keys(resultA.metrics.by_group ?? {}),
    ...Object.keys(resultB.metrics.by_group ?? {}),
  ]);
  const byGroupDelta: Record<string, Record<string, number>> = {};
  for (const group of allGroups) {
    const ga = resultA.metrics.by_group?.[group];
    const gb = resultB.metrics.by_group?.[group];
    if (ga && gb) {
      byGroupDelta[group] = computeMetricDelta(ga, gb);
    }
  }

  // Match evaluations by ID, fallback to question text
  const evalsAById = new Map<string, EvalItem>();
  const evalsByQuestion = new Map<string, EvalItem>();
  for (const ev of resultA.evaluations) {
    evalsAById.set(ev.id, ev);
    evalsByQuestion.set(ev.question, ev);
  }

  const flipDetails: FlipDetail[] = [];
  let unchangedCorrect = 0;
  let unchangedIncorrect = 0;

  for (const evB of resultB.evaluations) {
    const evA =
      evalsAById.get(evB.id) ?? evalsByQuestion.get(evB.question);
    if (!evA) continue;

    const verdictA = evA.judgment?.verdict ?? "error";
    const verdictB = evB.judgment?.verdict ?? "error";
    const scoreA = evA.judgment?.score ?? 0;
    const scoreB = evB.judgment?.score ?? 0;

    if (verdictA !== verdictB) {
      const isImprovement =
        (verdictA === "incorrect" || verdictA === "error") &&
        verdictB === "correct";

      flipDetails.push({
        question_id: evB.id,
        group: evB.group,
        question: evB.question,
        ground_truth: evB.ground_truth,
        direction: isImprovement ? "improvement" : "regression",
        verdict_a: verdictA,
        verdict_b: verdictB,
        score_a: scoreA,
        score_b: scoreB,
      });
    } else {
      if (verdictA === "correct") unchangedCorrect++;
      else unchangedIncorrect++;
    }
  }

  const improvements = flipDetails.filter(
    (f) => f.direction === "improvement",
  ).length;
  const regressions = flipDetails.filter(
    (f) => f.direction === "regression",
  ).length;

  // Sort: regressions first
  flipDetails.sort((a, b) => {
    if (a.direction === "regression" && b.direction === "improvement")
      return -1;
    if (a.direction === "improvement" && b.direction === "regression")
      return 1;
    return 0;
  });

  return NextResponse.json({
    run_a: {
      id: runA.id,
      project_name: runA.project_name,
      template_id: runA.template_id,
      config: parseJson(runA.config),
      started_at: runA.started_at,
    },
    run_b: {
      id: runB.id,
      project_name: runB.project_name,
      template_id: runB.template_id,
      config: parseJson(runB.config),
      started_at: runB.started_at,
    },
    config_diff: configDiff,
    metrics: {
      run_a: {
        overall: resultA.metrics.overall,
        by_group: resultA.metrics.by_group,
      },
      run_b: {
        overall: resultB.metrics.overall,
        by_group: resultB.metrics.by_group,
      },
      delta: { overall: overallDelta, by_group: byGroupDelta },
    },
    flips: {
      improvements,
      regressions,
      net: improvements - regressions,
      details: flipDetails,
    },
    unchanged: {
      correct: unchangedCorrect,
      incorrect: unchangedIncorrect,
    },
  });
}
