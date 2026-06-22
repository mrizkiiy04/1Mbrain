import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.resolve(__dirname, '../results');

const targetFile = 'raw_results.json';
const filePath = path.join(RESULTS_DIR, targetFile);

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

// The root data is an array of ProviderRunResult
const graphFullRun = rawData.find((r: any) => r.provider === '1mbrain_graph_full');
const vectorOnlyRun = rawData.find((r: any) => r.provider === '1mbrain_vector_only');

if (!graphFullRun || !vectorOnlyRun) {
  console.error('Missing run data for graph_full or vector_only');
  process.exit(1);
}

const casesMap = new Map<string, any>();
for (const vc of vectorOnlyRun.caseResults) {
  casesMap.set(vc.scenarioId, { vector: vc, graph: null });
}

for (const gc of graphFullRun.caseResults) {
  if (casesMap.has(gc.scenarioId)) {
    casesMap.get(gc.scenarioId).graph = gc;
  }
}

const regressions: any[] = [];

for (const [scenarioId, pair] of casesMap) {
  const g = pair.graph;
  const v = pair.vector;
  if (!g || !v) continue;

  const gEval = g.evaluation;
  const vEval = v.evaluation;

  // We want to find cases where Graph Full recall@5 OR MRR is worse than Vector Only, 
  // but evidence quality is tied or better. (Or just any MRR/recall drop).
  if (gEval.recallAt5 < vEval.recallAt5 || gEval.mrr < vEval.mrr) {
    regressions.push({
      scenarioId,
      scenarioType: g.scenarioType,
      graphEval: gEval,
      vectorEval: vEval,
      graphResults: g.results,
      vectorResults: v.results,
      // Attempt to deduce required/forbidden from failure tags or context, 
      // but we don't have the original benchmark expectations here easily.
      // We will print the returned IDs and scores.
    });
  }
}

console.log(`# Failure Diff Analysis Report`);
console.log(`Analyzing: ${targetFile}\n`);

if (regressions.length === 0) {
  console.log(`No regressions found! Graph Full is equal or better in MRR and Recall@5 on all cases.`);
  process.exit(0);
}

console.log(`Found ${regressions.length} cases where Graph Full had worse MRR or Recall@5 than Vector Only.\n`);

const failureCounts: Record<string, number> = {};

for (const r of regressions) {
  console.log(`## Scenario: ${r.scenarioId} (${r.scenarioType})`);
  console.log(`- Graph Full: MRR=${r.graphEval.mrr.toFixed(3)}, Recall@5=${r.graphEval.recallAt5.toFixed(3)}`);
  console.log(`- Vector Only: MRR=${r.vectorEval.mrr.toFixed(3)}, Recall@5=${r.vectorEval.recallAt5.toFixed(3)}`);
  
  const gTags = r.graphEval.failureTags.length ? r.graphEval.failureTags.join(', ') : 'none';
  console.log(`- Graph Failure Tags: ${gTags}`);
  
  for (const tag of r.graphEval.failureTags) {
    failureCounts[tag] = (failureCounts[tag] || 0) + 1;
  }

  console.log(`### Graph Full Returned (Top 5)`);
  r.graphResults.slice(0, 5).forEach((res: any, idx: number) => {
    console.log(`  ${idx + 1}. ${res.memoryId} (score: ${res.score.toFixed(4)})`);
  });

  console.log(`### Vector Only Returned (Top 5)`);
  r.vectorResults.slice(0, 5).forEach((res: any, idx: number) => {
    console.log(`  ${idx + 1}. ${res.memoryId} (score: ${res.score.toFixed(4)})`);
  });

  console.log(`---\n`);
}

console.log(`### Aggregated Regression Failure Tags for Graph Full:`);
Object.entries(failureCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([tag, count]) => {
    console.log(`- ${tag}: ${count}`);
  });
