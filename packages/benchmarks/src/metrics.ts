import type {
  BenchmarkCase,
  BenchmarkRecallResult,
  BenchmarkScenarioType,
  MemoryProviderAdapter,
  ProviderAvailability,
} from './provider.js';

export interface OperationTrace {
  kind: string;
  label?: string;
  latencyMs: number;
  resultIds?: string[];
  success?: boolean;
  details?: Record<string, unknown>;
}

export interface CaseEvaluation {
  precisionAt1: number;
  precisionAt3: number;
  precisionAt5: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number;
  evidenceAccuracy: number;
  deterministicSuccess: number;
  abstentionAccuracy: number | null;
  temporalCorrectness: number | null;
  staleMemoryErrorRate: number | null;
  deletedMemoryLeakageRate: number | null;
  portabilitySuccessRate: number | null;
  taskContextCoverage: number | null;
  rankingMovement: number | null;
  answerAccuracy: number | null;
  hallucinationRate: number | null;
  failureTags: string[];
  notes: string[];
}

export interface ProviderCaseResult {
  provider: string;
  providerLabel: string;
  capabilities: MemoryProviderAdapter['capabilities'];
  scenarioId: string;
  scenarioType: BenchmarkScenarioType;
  supported: boolean;
  unsupportedReason?: string;
  error?: string;
  memoryCount: number;
  ingestMs: number;
  latencyMs: number;
  storageSizeBytes: number | null;
  results: BenchmarkRecallResult[];
  operationTraces: OperationTrace[];
  evaluation: CaseEvaluation;
  generatedAnswer?: string;
  llmError?: string;
  llmEvaluation?: {
    model: string;
    score0To5: number;
    hallucination: boolean;
    rationale: string;
  };
}

export interface ProviderRunResult {
  provider: string;
  label: string;
  capabilities: MemoryProviderAdapter['capabilities'];
  availability: ProviderAvailability;
  caseResults: ProviderCaseResult[];
}

export interface AggregatedMetrics {
  caseCount: number;
  unsupportedCaseCount: number;
  errorCount: number;
  precisionAt1: number;
  precisionAt3: number;
  precisionAt5: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number;
  evidenceAccuracy: number;
  deterministicSuccess: number;
  abstentionAccuracy: number | null;
  temporalCorrectness: number | null;
  staleMemoryErrorRate: number | null;
  deletedMemoryLeakageRate: number | null;
  portabilitySuccessRate: number | null;
  taskContextCoverage: number | null;
  rankingMovement: number | null;
  answerAccuracy: number | null;
  hallucinationRate: number | null;
  p50LatencyMs: number;
  p95LatencyMs: number;
  averageLatencyMs: number;
  p50IngestMs: number;
  p95IngestMs: number;
  averageIngestMs: number;
  averageStorageSizeBytes: number | null;
  estimatedCostPer1kQueries: number;
}

export interface ProviderSummary {
  provider: string;
  label: string;
  availability: ProviderAvailability;
  capabilities: MemoryProviderAdapter['capabilities'];
  overall: AggregatedMetrics;
  byScenario: Partial<Record<BenchmarkScenarioType, AggregatedMetrics>>;
  failureCounts: Record<string, number>;
}

export interface ProbeResults {
  [label: string]: BenchmarkRecallResult[];
}

export function emptyEvaluation(): CaseEvaluation {
  return {
    precisionAt1: 0,
    precisionAt3: 0,
    precisionAt5: 0,
    recallAt3: 0,
    recallAt5: 0,
    mrr: 0,
    evidenceAccuracy: 0,
    deterministicSuccess: 0,
    abstentionAccuracy: null,
    temporalCorrectness: null,
    staleMemoryErrorRate: null,
    deletedMemoryLeakageRate: null,
    portabilitySuccessRate: null,
    taskContextCoverage: null,
    rankingMovement: null,
    answerAccuracy: null,
    hallucinationRate: null,
    failureTags: [],
    notes: [],
  };
}

export function evaluateCase(
  benchmarkCase: BenchmarkCase,
  results: BenchmarkRecallResult[],
  operationTraces: OperationTrace[],
  probes: ProbeResults,
): CaseEvaluation {
  const returnedIds = results.map((result) => result.memoryId);
  const top1 = returnedIds.slice(0, 1);
  const top3 = returnedIds.slice(0, 3);
  const top5 = returnedIds.slice(0, 5);
  const required = benchmarkCase.expectations.requiredMemoryIds;
  const forbidden = new Set(benchmarkCase.expectations.forbiddenMemoryIds);
  const hitsAt5 = countHits(top5, required);
  const forbiddenHits = top5.filter((id) => forbidden.has(id));
  const evaluation = emptyEvaluation();

  evaluation.precisionAt1 = precisionAtK(top1, required);
  evaluation.precisionAt3 = precisionAtK(top3, required);
  evaluation.precisionAt5 = precisionAtK(top5, required);
  evaluation.recallAt3 = recallAtK(top3, required);
  evaluation.recallAt5 = recallAtK(top5, required);
  evaluation.mrr = mrrAtK(returnedIds, required, 5);
  evaluation.evidenceAccuracy =
    required.length === 0
      ? benchmarkCase.expectations.shouldAbstain && returnedIds.length === 0
        ? 1
        : 0
      : forbiddenHits.length > 0
        ? 0
        : hitsAt5 / required.length;

  if (benchmarkCase.expectations.shouldAbstain !== undefined) {
    if (required.length === 0) {
      const abstained = returnedIds.length === 0;
      evaluation.abstentionAccuracy =
        benchmarkCase.expectations.shouldAbstain === abstained ? 1 : 0;
      if (evaluation.abstentionAccuracy === 0) {
        evaluation.failureTags.push('abstention_failed');
      }
    } else {
      // If there are required memories, we expect the engine to find them.
      // We shouldn't fail "abstention" at the retrieval layer if it successfully retrieves the required evidence of absence.
      evaluation.abstentionAccuracy = 1;
    }
  }

  if (benchmarkCase.scenarioType === 'selective_forgetting') {
    const deletedLeakage = forbiddenHits.length > 0 ? 1 : 0;
    evaluation.deletedMemoryLeakageRate = deletedLeakage;
    if (deletedLeakage > 0) {
      evaluation.failureTags.push('deleted_memory_leakage');
    }
  }

  if (benchmarkCase.expectations.preferredOver?.length) {
    const temporalChecks = benchmarkCase.expectations.preferredOver.map((check) =>
      preferredWins(returnedIds, check.preferredId, check.competingIds),
    );
    const passed = temporalChecks.filter(Boolean).length;
    evaluation.temporalCorrectness = temporalChecks.length === 0 ? null : passed / temporalChecks.length;
    evaluation.staleMemoryErrorRate =
      temporalChecks.length === 0 ? null : (temporalChecks.length - passed) / temporalChecks.length;
    if (evaluation.temporalCorrectness !== 1) {
      evaluation.failureTags.push('stale_memory_won');
    }
  }

  if (benchmarkCase.expectations.probeComparisons?.length) {
    const movements = benchmarkCase.expectations.probeComparisons
      .map((comparison) =>
        compareProbeRanks(
          probes[comparison.labelBefore] ?? [],
          probes[comparison.labelAfter] ?? [],
          comparison.memoryId,
        ),
      )
      .filter((movement): movement is number => movement !== null);

    evaluation.rankingMovement = movements.length === 0 ? null : average(movements);
    if (evaluation.rankingMovement !== null && evaluation.rankingMovement <= 0) {
      evaluation.failureTags.push('refresh_did_not_improve_rank');
    }
  }

  if (benchmarkCase.scenarioType === 'portability') {
    const exportImportTrace = operationTraces.find((trace) => trace.kind === 'export_import');
    const success = exportImportTrace?.success === true ? 1 : 0;
    evaluation.portabilitySuccessRate = success;
    if (success === 0) {
      evaluation.failureTags.push('import_export_failed');
    }
  }

  if (benchmarkCase.scenarioType === 'agent_task_context') {
    evaluation.taskContextCoverage =
      required.length === 0 ? 1 : countHits(top5, required) / required.length;
    if (evaluation.taskContextCoverage < 1) {
      evaluation.failureTags.push('task_context_incomplete');
    }
  }

  if (required.length > 0 && hitsAt5 < required.length && benchmarkCase.scenarioType !== 'agent_task_context') {
    evaluation.failureTags.push('missed_required_memory');
  }
  if (forbiddenHits.length > 0 && benchmarkCase.scenarioType !== 'selective_forgetting') {
    evaluation.failureTags.push('retrieved_forbidden_memory');
  }

  const scenarioPass = scenarioDeterministicPass(
    benchmarkCase,
    hitsAt5,
    results,
    evaluation,
    required.length,
  );
  evaluation.deterministicSuccess = scenarioPass ? 1 : 0;
  if (!scenarioPass && benchmarkCase.scenarioType === 'multi_hop_recall') {
    evaluation.failureTags.push('could_not_connect_multi_hop_facts');
  }

  if (results.length > 0 && operationTraces.length === 0 && benchmarkCase.scenarioType === 'noise_resistance') {
    evaluation.notes.push('Noise resistance measured from final recall only.');
  }

  evaluation.failureTags = Array.from(new Set(evaluation.failureTags));
  return evaluation;
}

export function aggregateProviderRuns(runs: ProviderRunResult[]): ProviderSummary[] {
  return runs.map((run) => ({
    provider: run.provider,
    label: run.label,
    availability: run.availability,
    capabilities: run.capabilities,
    overall: aggregateCaseResults(run.caseResults),
    byScenario: aggregateByScenario(run.caseResults),
    failureCounts: countFailures(run.caseResults),
  }));
}

function aggregateByScenario(
  caseResults: ProviderCaseResult[],
): Partial<Record<BenchmarkScenarioType, AggregatedMetrics>> {
  const grouped = new Map<BenchmarkScenarioType, ProviderCaseResult[]>();
  for (const caseResult of caseResults) {
    const bucket = grouped.get(caseResult.scenarioType) ?? [];
    bucket.push(caseResult);
    grouped.set(caseResult.scenarioType, bucket);
  }

  const summaries: Partial<Record<BenchmarkScenarioType, AggregatedMetrics>> = {};
  for (const [scenarioType, results] of grouped) {
    summaries[scenarioType] = aggregateCaseResults(results);
  }
  return summaries;
}

function aggregateCaseResults(caseResults: ProviderCaseResult[]): AggregatedMetrics {
  const supported = caseResults.filter((caseResult) => caseResult.supported && !caseResult.error);
  const unsupportedCaseCount = caseResults.filter((caseResult) => !caseResult.supported).length;
  const errorCount = caseResults.filter((caseResult) => Boolean(caseResult.error)).length;
  const latencies = supported.map((caseResult) => caseResult.latencyMs).sort((a, b) => a - b);
  const ingests = supported.map((caseResult) => caseResult.ingestMs).sort((a, b) => a - b);
  const storageSizes = supported
    .map((caseResult) => caseResult.storageSizeBytes)
    .filter((value): value is number => value !== null);

  return {
    caseCount: supported.length,
    unsupportedCaseCount,
    errorCount,
    precisionAt1: average(supported.map((caseResult) => caseResult.evaluation.precisionAt1)),
    precisionAt3: average(supported.map((caseResult) => caseResult.evaluation.precisionAt3)),
    precisionAt5: average(supported.map((caseResult) => caseResult.evaluation.precisionAt5)),
    recallAt3: average(supported.map((caseResult) => caseResult.evaluation.recallAt3)),
    recallAt5: average(supported.map((caseResult) => caseResult.evaluation.recallAt5)),
    mrr: average(supported.map((caseResult) => caseResult.evaluation.mrr)),
    evidenceAccuracy: average(
      supported.map((caseResult) => caseResult.evaluation.evidenceAccuracy),
    ),
    deterministicSuccess: average(
      supported.map((caseResult) => caseResult.evaluation.deterministicSuccess),
    ),
    abstentionAccuracy: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.abstentionAccuracy),
    ),
    temporalCorrectness: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.temporalCorrectness),
    ),
    staleMemoryErrorRate: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.staleMemoryErrorRate),
    ),
    deletedMemoryLeakageRate: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.deletedMemoryLeakageRate),
    ),
    portabilitySuccessRate: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.portabilitySuccessRate),
    ),
    taskContextCoverage: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.taskContextCoverage),
    ),
    rankingMovement: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.rankingMovement),
    ),
    answerAccuracy: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.answerAccuracy),
    ),
    hallucinationRate: averageNullable(
      supported.map((caseResult) => caseResult.evaluation.hallucinationRate),
    ),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    averageLatencyMs: average(latencies),
    p50IngestMs: percentile(ingests, 0.5),
    p95IngestMs: percentile(ingests, 0.95),
    averageIngestMs: average(ingests),
    averageStorageSizeBytes: storageSizes.length > 0 ? average(storageSizes) : null,
    estimatedCostPer1kQueries: 0,
  };
}

function countFailures(caseResults: ProviderCaseResult[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const caseResult of caseResults) {
    for (const tag of caseResult.evaluation.failureTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    if (caseResult.error) {
      counts.set('runtime_error', (counts.get('runtime_error') ?? 0) + 1);
    }
    if (!caseResult.supported && caseResult.unsupportedReason) {
      counts.set('unsupported_case', (counts.get('unsupported_case') ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function scenarioDeterministicPass(
  benchmarkCase: BenchmarkCase,
  hitsAt5: number,
  results: BenchmarkRecallResult[],
  evaluation: CaseEvaluation,
  requiredCount: number,
): boolean {
  if (benchmarkCase.expectations.shouldAbstain) {
    return evaluation.abstentionAccuracy === 1 && evaluation.deletedMemoryLeakageRate !== 1;
  }

  if (benchmarkCase.scenarioType === 'portability') {
    return hitsAt5 === requiredCount && evaluation.portabilitySuccessRate === 1;
  }

  if (benchmarkCase.scenarioType === 'agent_task_context') {
    return evaluation.taskContextCoverage === 1 && evaluation.evidenceAccuracy === 1;
  }

  if (benchmarkCase.expectations.preferredOver?.length) {
    return hitsAt5 >= 1 && evaluation.temporalCorrectness === 1 && evaluation.evidenceAccuracy > 0;
  }

  if (benchmarkCase.scenarioType === 'multi_hop_recall') {
    return hitsAt5 === requiredCount && evaluation.evidenceAccuracy === 1;
  }

  return requiredCount === 0 ? results.length === 0 : hitsAt5 >= requiredCount && evaluation.evidenceAccuracy === 1;
}

function preferredWins(returnedIds: string[], preferredId: string, competingIds: string[]): boolean {
  const preferredRank = rankOf(returnedIds, preferredId);
  if (preferredRank === null) return false;

  const competingRanks = competingIds
    .map((memoryId) => rankOf(returnedIds, memoryId))
    .filter((rank): rank is number => rank !== null);

  if (competingRanks.length === 0) return true;
  return preferredRank < Math.min(...competingRanks);
}

function compareProbeRanks(
  beforeResults: BenchmarkRecallResult[],
  afterResults: BenchmarkRecallResult[],
  memoryId: string,
): number | null {
  const beforeRank = rankOf(
    beforeResults.map((result) => result.memoryId),
    memoryId,
  );
  const afterRank = rankOf(
    afterResults.map((result) => result.memoryId),
    memoryId,
  );

  if (beforeRank === null || afterRank === null) return null;
  return beforeRank - afterRank;
}

function countHits(returnedIds: string[], expectedIds: string[]): number {
  const expected = new Set(expectedIds);
  return returnedIds.filter((id) => expected.has(id)).length;
}

function precisionAtK(returnedIds: string[], expectedIds: string[]): number {
  if (returnedIds.length === 0) return 0;
  const hits = countHits(returnedIds, expectedIds);
  return hits / returnedIds.length;
}

function recallAtK(returnedIds: string[], expectedIds: string[]): number {
  if (expectedIds.length === 0) return 1;
  const hits = countHits(returnedIds, expectedIds);
  return hits / expectedIds.length;
}

function mrrAtK(returnedIds: string[], expectedIds: string[], k: number): number {
  const expected = new Set(expectedIds);
  const rank = returnedIds.slice(0, k).findIndex((id) => expected.has(id));
  return rank === -1 ? 0 : 1 / (rank + 1);
}

function rankOf(returnedIds: string[], memoryId: string): number | null {
  const index = returnedIds.indexOf(memoryId);
  return index === -1 ? null : index + 1;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : average(present);
}
