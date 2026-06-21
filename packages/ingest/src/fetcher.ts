/**
 * URL Fetcher
 *
 * Fetches a web page with robust error handling:
 * - Follows redirects, returns final URL
 * - Rejects non-HTML content
 * - Configurable timeout
 * - User-agent spoofing to avoid bot blocks
 */

const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  'Mozilla/5.0 (compatible; 1MBrainBot/1.0; +https://github.com/1mbrain) AppleWebKit/537.36';

export interface FetchResult {
  html: string;
  finalUrl: string;
  contentType: string;
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/**
 * Fetch the HTML content of a URL.
 * Throws FetchError on network/HTTP failures or non-HTML content.
 */
export async function fetchPage(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchResult> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new FetchError(`Invalid URL: ${url}`, undefined, url);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new FetchError(
      `Unsupported protocol: ${parsedUrl.protocol}. Only http/https are allowed.`,
      undefined,
      url,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new FetchError(
        `HTTP ${response.status} ${response.statusText} for ${url}`,
        response.status,
        url,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml') &&
      !contentType.includes('text/plain')
    ) {
      throw new FetchError(
        `Unsupported content type: ${contentType}. Only HTML pages can be ingested.`,
        undefined,
        url,
      );
    }

    const html = await response.text();
    const finalUrl = response.url || url;

    return { html, finalUrl, contentType };
  } catch (err) {
    if (err instanceof FetchError) throw err;

    const name = (err as Error)?.name;
    if (name === 'AbortError') {
      throw new FetchError(
        `Fetch timed out after ${timeoutMs}ms for ${url}`,
        undefined,
        url,
      );
    }

    throw new FetchError(
      `Network error fetching ${url}: ${(err as Error).message}`,
      undefined,
      url,
    );
  } finally {
    clearTimeout(timer);
  }
}
