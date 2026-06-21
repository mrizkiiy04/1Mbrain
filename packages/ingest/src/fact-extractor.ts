/**
 * Fact Extractor
 *
 * Uses a configured LLM to extract structured factual claims from a Markdown chunk.
 *
 * The LLM is instructed to:
 * 1. Extract only stable, factual, reusable information
 * 2. Skip ads, opinions, CTAs, and navigation text
 * 3. Return structured JSON with confidence scores
 * 4. Classify each fact by memory type (semantic/episodic/procedural/entity/warning)
 *
 * The LLM client is inherited from the user's existing embedding provider config.
 */

import type { LLMClient } from './llm-client.js';
import type { ExtractedFact, FactExtractionInput } from './types.js';
import type { MemoryType } from '@1mbrain/core';

// ─── System Prompt ────────────────────────────────────────

const SYSTEM_PROMPT = `You are a factual memory extractor for an AI memory system.

Your task: extract only stable, factual, reusable information from the provided Markdown chunk.

Rules:
- DO NOT store: ads, navigation text, opinions, hype, CTA text, duplicated text, boilerplate.
- DO NOT invent facts. Every claim must be directly supported by the chunk.
- Each claim must be a complete, self-contained statement (not a fragment).
- Prefer concise claims (1-2 sentences max).
- If the chunk contains no useful factual memory, return an empty facts array.

Memory type classification:
- "semantic": General facts, definitions, concepts, relationships (most common)
- "episodic": Time-specific events, announcements, releases with a specific date
- "procedural": How-to instructions, steps, processes, commands
- "entity": Named entities — people, organizations, products, places — with key attributes
- "warning": Risks, caveats, known issues, deprecation notices, security alerts

Importance scoring (0.0 - 1.0):
- 0.9-1.0: Core facts, key entities, critical warnings
- 0.7-0.8: Useful supporting facts, features, specifications
- 0.5-0.6: Context, background, minor details
- Below 0.5: Skip (set shouldRemember to false)

Confidence scoring (0.0 - 1.0):
- How confident are you that this is a genuine factual claim (not an opinion or ad)?
- Below 0.75: set shouldRemember to false

Return ONLY valid JSON matching this schema:
{
  "facts": [
    {
      "claim": "string — concise factual statement",
      "type": "semantic | episodic | procedural | entity | warning",
      "importance": 0.0-1.0,
      "confidence": 0.0-1.0,
      "tags": ["string", "..."],
      "evidence": "string — the relevant text from the chunk that supports this claim",
      "shouldRemember": true | false
    }
  ]
}`;

// ─── Fact Extraction ─────────────────────────────────────

const VALID_MEMORY_TYPES: Set<string> = new Set([
  'semantic',
  'episodic',
  'procedural',
  'entity',
  'warning',
]);

interface RawFact {
  claim?: unknown;
  type?: unknown;
  importance?: unknown;
  confidence?: unknown;
  tags?: unknown;
  evidence?: unknown;
  shouldRemember?: unknown;
}

/**
 * Extract factual claims from a single Markdown chunk using the LLM.
 *
 * @param input - The chunk context (title, url, index, markdown)
 * @param client - LLM client to use for extraction
 * @returns Array of extracted facts (may be empty)
 */
export async function extractFactsFromChunk(
  input: FactExtractionInput,
  client: LLMClient,
): Promise<ExtractedFact[]> {
  const userPrompt = `Source: ${input.title}
URL: ${input.url}
Chunk: ${input.chunkIndex + 1}

---

${input.markdown}`;

  let rawContent: string;

  try {
    const result = await client.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      true, // JSON mode
    );
    rawContent = result.content;
  } catch (err) {
    // LLM unavailable — return empty (pipeline continues gracefully)
    throw new Error(`LLM call failed for chunk ${input.chunkIndex}: ${(err as Error).message}`);
  }

  // Parse and validate LLM output
  let parsed: { facts?: RawFact[] };
  try {
    parsed = JSON.parse(rawContent) as { facts?: RawFact[] };
  } catch {
    // LLM returned invalid JSON — log and return empty
    return [];
  }

  if (!Array.isArray(parsed.facts)) {
    return [];
  }

  const facts: ExtractedFact[] = [];

  for (const raw of parsed.facts) {
    if (typeof raw !== 'object' || raw === null) continue;

    const claim = typeof raw.claim === 'string' ? raw.claim.trim() : '';
    if (!claim) continue;

    const type: MemoryType = VALID_MEMORY_TYPES.has(raw.type as string)
      ? (raw.type as MemoryType)
      : 'semantic';

    const importance =
      typeof raw.importance === 'number' ? Math.max(0, Math.min(1, raw.importance)) : 0.5;

    const confidence =
      typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5;

    const tags = Array.isArray(raw.tags)
      ? (raw.tags as unknown[])
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.toLowerCase().replace(/\s+/g, '-').slice(0, 64))
          .slice(0, 16)
      : [];

    const evidence = typeof raw.evidence === 'string' ? raw.evidence.slice(0, 512) : '';

    const shouldRemember =
      raw.shouldRemember === true &&
      importance >= 0.5 &&
      confidence >= 0.75; // Extra safety gate

    facts.push({ claim, type, importance, confidence, tags, evidence, shouldRemember });
  }

  return facts;
}
