/**
 * URL Fetcher
 *
 * Fetches a web page with robust error handling and SSRF protection:
 * - Validates URLs and DNS before fetching
 * - Blocks loopback, private, and reserved IP ranges
 * - Follows redirects manually (with DNS checks on each redirect)
 * - Configurable timeout
 * - Rejects non-HTML content
 */

import dns from 'dns/promises';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

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
 * Checks if an IP address is a private, loopback, or reserved IP.
 */
function isPrivateIp(ip: string): boolean {
  // IPv4 exact loopback
  if (ip === '127.0.0.1') return true;
  // IPv4 private & loopback ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
  if (/^(10|127)\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  // AWS Metadata service
  if (ip === '169.254.169.254') return true;
  
  // IPv6 loopback and unique local address
  if (ip === '::1') return true;
  if (/^f[c-d][0-9a-f]{2}:/i.test(ip)) return true;

  return false;
}

/**
 * Validates the URL and performs a DNS lookup to prevent SSRF.
 * Throws FetchError if the IP is forbidden.
 */
async function validateUrlForSsrf(urlString: string): Promise<URL> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new FetchError(`Invalid URL: ${urlString}`, undefined, urlString);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new FetchError(
      `Unsupported protocol: ${parsedUrl.protocol}. Only http/https are allowed.`,
      undefined,
      urlString,
    );
  }

  // Check hostname (prevent basic localhost bypasses)
  if (parsedUrl.hostname === 'localhost') {
    throw new FetchError(`Forbidden host: ${parsedUrl.hostname}`, undefined, urlString);
  }

  // Resolve DNS to verify IP
  try {
    const lookup = await dns.lookup(parsedUrl.hostname);
    if (isPrivateIp(lookup.address)) {
      throw new FetchError(`Forbidden IP address resolved: ${lookup.address}`, undefined, urlString);
    }
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw new FetchError(`DNS resolution failed for ${parsedUrl.hostname}`, undefined, urlString);
  }

  return parsedUrl;
}

/**
 * Fetch the HTML content of a URL with SSRF protection.
 */
export async function fetchPage(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchResult> {
  
  let currentUrl = url;
  let redirects = 0;
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    while (redirects <= MAX_REDIRECTS) {
      const parsedUrl = await validateUrlForSsrf(currentUrl);

      const response = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        },
        redirect: 'manual', // We handle redirects to validate SSRF on each hop
      });

      // Handle Redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new FetchError(`Redirect without Location header for ${currentUrl}`, response.status, currentUrl);
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirects++;
        continue;
      }

      if (!response.ok) {
        throw new FetchError(
          `HTTP ${response.status} ${response.statusText} for ${currentUrl}`,
          response.status,
          currentUrl,
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
          currentUrl,
        );
      }

      const html = await response.text();
      return { html, finalUrl: currentUrl, contentType };
    }
    
    throw new FetchError(`Too many redirects (${MAX_REDIRECTS}) for ${url}`, undefined, url);

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
