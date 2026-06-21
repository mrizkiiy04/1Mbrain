/**
 * Content Filter
 *
 * Hard reject layer — prevents sensitive, promotional, or low-quality
 * content from ever reaching the LLM or the memory store.
 *
 * This runs BEFORE LLM fact extraction to save tokens on junk content.
 */

// ─── Blocked content patterns ─────────────────────────────

/** These keywords in fact claims → always reject */
const BLOCKED_CLAIM_KEYWORDS: string[] = [
  // Sensitive data
  'password',
  'api key',
  'secret key',
  'access token',
  'bearer token',
  'private key',
  'credit card',
  'social security',
  'ssn',
  'date of birth',
  // Financial / legal boilerplate
  'terms of service',
  'privacy policy',
  'cookie policy',
  'gdpr',
  'all rights reserved',
  'copyright ©',
  // Marketing / promotions
  'subscribe now',
  'sign up free',
  'limited time offer',
  'buy now',
  'click here',
  'download now',
  'get started for free',
  // Auth / login
  'forgot your password',
  'create an account',
  'already have an account',
  'log in to',
  // Ad markers
  'advertisement',
  'sponsored content',
  'paid partnership',
];

/** These URL patterns indicate pages that should not be ingested */
const BLOCKED_URL_PATTERNS: RegExp[] = [
  /\/(login|signin|signup|register|auth|oauth|accounts)\b/i,
  /\/(checkout|cart|payment|billing)\b/i,
  /\/(bank|banking|finance)\b/i,
  /\/(email|mail|inbox|compose)\b/i,
  /localhost/i,
  /^(file|data|javascript):/i,
];

// ─── Public API ───────────────────────────────────────────

/**
 * Check if a URL should be blocked from ingestion entirely.
 * Called before fetching the page.
 */
export function isBlockedUrl(url: string): { blocked: boolean; reason?: string } {
  for (const pattern of BLOCKED_URL_PATTERNS) {
    if (pattern.test(url)) {
      return { blocked: true, reason: `URL matches blocked pattern: ${pattern.source}` };
    }
  }
  return { blocked: false };
}

/**
 * Check if a fact claim should be rejected.
 * Called after LLM extraction, before storing to memory.
 *
 * @param claim - The extracted factual claim text
 */
export function isBlockedClaim(claim: string): { blocked: boolean; reason?: string } {
  const lower = claim.toLowerCase();

  for (const keyword of BLOCKED_CLAIM_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        blocked: true,
        reason: `Claim contains blocked keyword: "${keyword}"`,
      };
    }
  }

  // Reject extremely short claims (< 20 chars) — likely noise
  if (claim.trim().length < 20) {
    return { blocked: true, reason: 'Claim too short to be factual' };
  }

  // Reject claims that are mostly punctuation / numbers
  const alphaRatio = (claim.match(/[a-zA-Z]/g) ?? []).length / claim.length;
  if (alphaRatio < 0.4) {
    return { blocked: true, reason: 'Claim lacks alphabetic content' };
  }

  return { blocked: false };
}

/**
 * Check if a Markdown chunk is worth sending to the LLM.
 * Saves tokens on obviously noise-only chunks.
 *
 * @param chunk - Cleaned Markdown chunk text
 */
export function isChunkWorthExtracting(chunk: string): boolean {
  const words = chunk.split(/\s+/).filter((w) => w.length > 3);
  // Need at least 15 meaningful words to bother calling LLM
  if (words.length < 15) return false;

  // If > 30% of lines are headings, it might be a nav/menu block
  const lines = chunk.split('\n').filter((l) => l.trim());
  const headingLines = lines.filter((l) => /^#{1,4}\s/.test(l));
  if (lines.length > 0 && headingLines.length / lines.length > 0.3) return false;

  return true;
}
