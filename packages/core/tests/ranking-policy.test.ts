import { describe, expect, it } from 'vitest';
import { RankingPolicy } from '../src/ranking-policy.js';
import type { Association, Memory, SearchResult } from '../src/types.js';

describe('RankingPolicy', () => {
  it('adds ranking trace entries for graph-aware boosts', async () => {
    const anchor = makeMemory(
      'anchor',
      'Devon said the approval ritual is internally called Silver File.',
    );
    const answer = makeMemory(
      'answer',
      'Before the ethics submission team signs off, they require the redacted consent ledger.',
    );
    const associations = new Map<string, Association[]>([
      [
        'anchor',
        [
          {
            sourceId: 'anchor',
            targetId: 'answer',
            strength: 0.9,
            origin: 'explicit',
            relationType: 'relates_to',
            createdAt: new Date(),
          },
        ],
      ],
      [
        'answer',
        [
          {
            sourceId: 'anchor',
            targetId: 'answer',
            strength: 0.9,
            origin: 'explicit',
            relationType: 'relates_to',
            createdAt: new Date(),
          },
        ],
      ],
    ]);
    const policy = new RankingPolicy(async (memoryId) => associations.get(memoryId) ?? []);

    const outcome = await policy.rank('Which artifact is needed before approval sign off?', [
      makeResult(anchor, 0.5),
      makeResult(answer, 0.4),
    ]);

    const rankedAnswer = outcome.results.find((result) => result.memory.id === 'answer');
    expect(rankedAnswer?.rankingTrace).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^explicit_link:/),
        expect.stringMatching(/^query_answer:/),
      ]),
    );
  });

  it('abstains when strong absence evidence beats positive evidence', async () => {
    const policy = new RankingPolicy(async () => []);

    const outcome = await policy.rank('What artifact is needed for Zeta Project release approval?', [
      makeResult(
        makeMemory(
          'negative',
          'Tempting gap: Zeta Project release approval artifact is not stated in the record.',
        ),
        0.8,
      ),
      makeResult(
        makeMemory('positive', 'Beta Project release approval requires the consent ledger.'),
        0.4,
      ),
    ]);

    expect(outcome.abstained).toBe(true);
  });

  it('boosts relevant unknown-state evidence instead of abstaining', async () => {
    const policy = new RankingPolicy(async () => []);

    const outcome = await policy.rank('When will Snapbuild v1.3 be released?', [
      makeResult(
        makeMemory(
          'distractor',
          "Distractor: Snapbuild's internal codename during development was Piston.",
        ),
        0.65,
      ),
      makeResult(
        makeMemory(
          'older-release',
          'Snapbuild v1.2 launched on March 28, 2026, introducing parallel builds.',
        ),
        0.72,
      ),
      makeResult(
        makeMemory(
          'unknown-release',
          'Raj mentioned Docker integration as the next major Snapbuild feature, but no release date or v1.3 timeline has been announced.',
        ),
        0.45,
      ),
    ]);

    expect(outcome.abstained).toBe(false);
    expect(outcome.results[0].memory.id).toBe('unknown-release');
    expect(outcome.results[0].rankingTrace).toEqual(
      expect.arrayContaining([expect.stringMatching(/^evidence_rerank:\+/)]),
    );
  });

  it('demotes stale initial state when query asks whether a fact is still current', async () => {
    const policy = new RankingPolicy(async () => []);

    const outcome = await policy.rank('Is FormFlow still priced at $29/month?', [
      makeResult(
        makeMemory(
          'initial-price',
          "FormFlow's initial pricing was $29/month per workspace, with no annual-plan discount.",
        ),
        0.82,
      ),
      makeResult(
        makeMemory(
          'raised-price',
          'Maya raised the base price to $39/month per workspace after a competitor analysis in January 2026.',
        ),
        0.52,
      ),
      makeResult(
        makeMemory(
          'annual-discount',
          'In February 2026 Maya introduced an annual-plan discount: 20% off, bringing the annual equivalent to roughly $31/month.',
        ),
        0.48,
      ),
    ]);

    expect(outcome.results[0].memory.id).not.toBe('initial-price');
    expect(outcome.results.find((result) => result.memory.id === 'initial-price')?.rankingTrace).toEqual(
      expect.arrayContaining([expect.stringMatching(/^stale_penalty:/)]),
    );
  });

  it('prefers the queried person over related-person distractors', async () => {
    const policy = new RankingPolicy(async () => []);

    const outcome = await policy.rank("What is the name of Leila's therapist?", [
      makeResult(
        makeMemory(
          'sister-distractor',
          "Distractor: Leila's sister also sees a therapist, though a different practice and not CBT-based.",
        ),
        0.56,
      ),
      makeResult(
        makeMemory(
          'target',
          'Leila Nazari, 34, began therapy with Dr. Sandra Bloom, a CBT-focused psychologist, in October 2025.',
        ),
        0.42,
      ),
    ]);

    expect(outcome.results[0].memory.id).toBe('target');
    expect(outcome.results[0].rankingTrace).toEqual(
      expect.arrayContaining([expect.stringMatching(/^evidence_rerank:\+/)]),
    );
  });

  it('detects naturalistic absence evidence (not just benchmark-format)', async () => {
    const policy = new RankingPolicy(async () => []);

    // Naturalistic phrasing: "there is no X" and "has not Y"
    const outcome = await policy.rank('Does Priya have a family-plan pricing tier?', [
      makeResult(
        makeMemory(
          'absence-naturalistic',
          "There is no family-plan tier in Priya's product. She has not announced any plans for group pricing.",
        ),
        0.55,
      ),
      makeResult(
        makeMemory(
          'unrelated-positive',
          'Priya launched a referral bonus program in March 2026.',
        ),
        0.30,
      ),
    ]);

    // Should abstain or at least rank the absence evidence first
    if (!outcome.abstained) {
      expect(outcome.results[0].memory.id).toBe('absence-naturalistic');
    } else {
      expect(outcome.abstained).toBe(true);
    }
  });

  it('detects naturalistic near-entity distractors beyond fixture format', async () => {
    const policy = new RankingPolicy(async () => []);

    const outcome = await policy.rank("What is Marcus's primary brokerage?", [
      makeResult(
        makeMemory(
          'target',
          'Marcus currently uses Vanguard as his primary brokerage.',
        ),
        0.50,
      ),
      makeResult(
        makeMemory(
          'distractor-naturalistic',
          'A different person named Martin uses Fidelity — not related to Marcus at all.',
        ),
        0.65,
      ),
    ]);

    expect(outcome.results[0].memory.id).toBe('target');
  });

  it('abstains when naturalistic absence evidence has higher coverage than weak positive candidates', async () => {
    const policy = new RankingPolicy(async () => []);

    // Absence evidence covers the query well; positive candidates barely cover it
    const outcome = await policy.rank('What is the status of Project Athena release?', [
      makeResult(
        makeMemory(
          'absence-strong',
          'There is no announcement or release date for Project Athena. The team has not confirmed any timeline.',
        ),
        0.55,
      ),
      makeResult(makeMemory('r2', 'User prefers dark mode in the IDE.'), 0.15),
      makeResult(makeMemory('r3', 'Coffee was ordered at 10am.'), 0.12),
    ]);

    expect(outcome.abstained).toBe(true);
  });
});


function makeResult(memory: Memory, score: number): SearchResult {
  return {
    memory,
    score,
    source: 'vector',
  };
}

function makeMemory(id: string, content: string): Memory {
  const now = new Date('2026-06-19T00:00:00Z');
  return {
    id,
    agentId: 'ranking-test-agent',
    type: 'semantic',
    content,
    embeddingModel: 'test',
    embedding: [1],
    importance: 0.5,
    decayScore: 1,
    createdAt: now,
    lastAccessedAt: now,
    tags: [],
  };
}
