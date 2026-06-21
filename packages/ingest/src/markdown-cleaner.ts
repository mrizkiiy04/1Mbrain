/**
 * Markdown Cleaner
 *
 * Post-processes raw Markdown from turndown to remove:
 * - Excessive blank lines
 * - Inline images
 * - CTA phrases (subscribe, sign up, etc.)
 * - Anchor-only links (no text value)
 * - Redundant whitespace
 */

const CTA_PATTERNS: RegExp[] = [
  /^(subscribe|sign up|sign in|log in|login|register|get started|start free|try for free).*/gim,
  /^(advertisement|sponsored|promoted|ad\s*·).*/gim,
  /^(cookie policy|privacy policy|terms of service|all rights reserved).*/gim,
  /^(related articles?|you may also like|read more|see also|more from).*/gim,
  /^(share this|follow us|tweet|like|pin it).*/gim,
  /\[!\[.*?\]\(.*?\)\]\(.*?\)/g, // Linked images
  /!\[.*?\]\(.*?\)/g,            // Inline images
  /\[([^\]]*)\]\(#[^)]*\)/g,    // Anchor-only links (e.g. [Back to top](#top))
];

/**
 * Clean a raw Markdown string.
 * Returns a normalized, noise-free version ready for chunking.
 */
export function cleanMarkdown(markdown: string): string {
  let cleaned = markdown;

  // Apply CTA/noise patterns
  for (const pattern of CTA_PATTERNS) {
    cleaned = cleaned.replace(pattern, (_match, group1: string | undefined) => {
      // For text-based patterns, replace with empty; for link patterns keep text only
      if (group1 !== undefined) return group1; // anchor links: keep display text
      return '';
    });
  }

  // Normalize line endings
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Collapse 3+ consecutive blank lines to 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Remove lines that are only whitespace or dashes (horizontal rules from nav)
  cleaned = cleaned.replace(/^[\s-]{0,3}[-]{3,}[\s-]{0,3}$/gm, '');

  // Remove trailing whitespace on each line
  cleaned = cleaned.replace(/[ \t]+$/gm, '');

  // Strip lines that are too short to carry factual content (likely UI fragments)
  const lines = cleaned.split('\n');
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    // Allow headings, list items, blank lines, and code blocks
    if (trimmed.startsWith('#')) return true;
    if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('>'))
      return true;
    if (trimmed.startsWith('```') || trimmed === '') return true;
    // Drop very short non-structural lines (< 12 chars) — usually UI noise
    return trimmed.length >= 12;
  });

  return filtered.join('\n').trim();
}
