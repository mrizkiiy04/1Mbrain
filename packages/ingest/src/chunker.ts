/**
 * Markdown Chunker
 *
 * Splits cleaned Markdown into semantically coherent chunks for:
 * 1. Better embedding accuracy (shorter = more focused vectors)
 * 2. Granular fact extraction (LLM works on focused context)
 * 3. More precise semantic search results
 *
 * Strategy:
 * - Primary split: heading boundaries (## or ###)
 * - Secondary split: paragraph boundaries (\n\n)
 * - Hard cap: maxChars (default 1800) — splits on sentence boundary if exceeded
 */

import type { MarkdownChunk } from './types.js';

const DEFAULT_MAX_CHARS = 1800;
const MIN_CHUNK_CHARS = 80; // Skip chunks smaller than this — probably just a heading

/**
 * Split cleaned Markdown into chunks.
 * Each chunk is self-contained enough for LLM fact extraction.
 */
export function chunkMarkdown(
  markdown: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  let currentSection = '';


  const lines = markdown.split('\n');

  for (const line of lines) {
    const isHeading = /^#{1,4}\s/.test(line);

    if (isHeading) {
      // Flush current section before starting a new one
      if (currentSection.trim().length >= MIN_CHUNK_CHARS) {
        flushChunks(currentSection.trim(), maxChars, chunks);
      }
      currentSection = line + '\n';

    } else {
      currentSection += line + '\n';
    }
  }

  // Flush final section
  if (currentSection.trim().length >= MIN_CHUNK_CHARS) {
    flushChunks(currentSection.trim(), maxChars, chunks);
  }

  // If we got nothing (flat document with no headings), chunk by paragraphs
  if (chunks.length === 0) {
    const paragraphs = markdown.split(/\n\s*\n/g).filter((p) => p.trim().length >= MIN_CHUNK_CHARS);
    let current = '';

    for (const paragraph of paragraphs) {
      if ((current + '\n\n' + paragraph).length > maxChars && current.length > 0) {
        chunks.push({ index: chunks.length, content: current.trim() });
        current = paragraph;
      } else {
        current += (current ? '\n\n' : '') + paragraph;
      }
    }

    if (current.trim().length >= MIN_CHUNK_CHARS) {
      chunks.push({ index: chunks.length, content: current.trim() });
    }
  }

  // Re-index
  return chunks.map((c, i) => ({ ...c, index: i }));
}

/**
 * Flush content into chunks, splitting at sentence boundaries if it exceeds maxChars.
 */
function flushChunks(content: string, maxChars: number, out: MarkdownChunk[]): void {
  if (content.length <= maxChars) {
    out.push({ index: out.length, content });
    return;
  }

  // Content is too large — split at sentence boundaries
  const sentences = content.split(/(?<=[.!?])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxChars && current.length > 0) {
      if (current.trim().length >= MIN_CHUNK_CHARS) {
        out.push({ index: out.length, content: current.trim() });
      }
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim().length >= MIN_CHUNK_CHARS) {
    out.push({ index: out.length, content: current.trim() });
  }
}
