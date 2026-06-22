import { expect, it } from 'vitest';
import { createIsolatedEngine } from './tests/helpers';
import { ZeroEmbeddingProvider } from './tests/mocks';

async function run() {
  const rankingEngine = await createIsolatedEngine(new ZeroEmbeddingProvider());
  
  try {
    const original = await rankingEngine.remember({
      agentId: 'ranking-agent',
      type: 'semantic',
      content:
        "Hana Mori is writing her debut literary fiction novel, originally titled 'Saltwater Reckoning'.",
      tags: ['hana', 'novel'],
      metadata: { benchTimestamp: '2025-09-01T09:00:00Z' },
    });
    const current = await rankingEngine.remember({
      agentId: 'ranking-agent',
      type: 'episodic',
      content:
        "Hana changed the novel's title to 'The Weight of Salt' in January 2026, feeling the original title was too literal.",
      tags: ['hana', 'title'],
      metadata: { benchTimestamp: '2026-01-20T10:00:00Z' },
    });
  
    console.log("Memory IDs:", original.id, current.id);
  
    const textCandidates = await (rankingEngine as any).db.searchByText('ranking-agent', "What is the current title of Hana's novel?");
    console.log("Text Candidates from DB:", textCandidates);

    const lexicalCandidates = await (rankingEngine as any).lexicalCandidateSearch(
      {
          agentId: 'ranking-agent',
          query: "What is the current title of Hana's novel?",
          limit: 3,
          threshold: 0.5,
          useSpreadingActivation: true,
          activationThreshold: 0.05,
      },
      false,
      3
    );
    console.log("Lexical Candidates:", lexicalCandidates);

    const results = await rankingEngine.recall({
      agentId: 'ranking-agent',
      query: "What is the current title of Hana's novel?",
      limit: 3,
      threshold: 0.5,
      useSpreadingActivation: true,
      activationThreshold: 0.05,
    });
    
    console.log("Results from recall:", results);
  } finally {
    await rankingEngine.shutdown();
  }
}

run().catch(console.error);
