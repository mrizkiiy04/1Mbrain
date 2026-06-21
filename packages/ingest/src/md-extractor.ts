/**
 * Markdown Extractor
 *
 * Converts raw HTML into clean Markdown using:
 * 1. @mozilla/readability — extracts the "article" content (strips nav, ads, etc.)
 * 2. JSDOM — provides a DOM for Readability to parse
 * 3. Turndown — converts the clean HTML to Markdown
 *
 * Also computes a SHA-256 sourceHash for deduplication.
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { ExtractedPage } from './types.js';

/**
 * Compute a SHA-256 hash of a string (Node.js built-in crypto).
 */
async function sha256(input: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Extract readable content from raw HTML and convert to Markdown.
 *
 * @param html - Raw HTML string
 * @param url - URL the page was fetched from (used by Readability for relative URLs)
 */
export async function extractMarkdown(html: string, url: string): Promise<ExtractedPage> {
  // Parse HTML via JSDOM so Readability can work with it
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  // Try Readability article extraction first
  const reader = new Readability(document, {
    charThreshold: 50,
    keepClasses: false,
  });
  const article = reader.parse();

  let title = '';
  let contentHtml = '';

  if (article && article.content && article.textContent.trim().length > 100) {
    // Readability succeeded — use extracted article
    title = article.title?.trim() || document.title?.trim() || '';
    contentHtml = article.content;
  } else {
    // Fallback: strip obvious noise and use whole body
    title = document.title?.trim() || '';
    const body = document.body;

    // Remove noisy elements
    const noisy = ['script', 'style', 'nav', 'footer', 'aside', 'iframe', 'noscript', 'header'];
    noisy.forEach((sel) => {
      body.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // Prefer <article> or <main> over raw body
    const main = body.querySelector('article') ?? body.querySelector('main') ?? body;
    contentHtml = main.innerHTML;
  }

  // Convert HTML → Markdown
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
  });

  // Remove images and complex link syntax during conversion
  td.addRule('removeImages', {
    filter: 'img',
    replacement: () => '',
  });

  const markdown = td.turndown(contentHtml);

  // Compute plain text for hashing
  const textContent = markdown.replace(/\s+/g, ' ').trim();

  const capturedAt = new Date().toISOString();
  const sourceHash = await sha256(`${url}::${textContent}`);

  return {
    title,
    url,
    markdown,
    textContent,
    capturedAt,
    sourceHash,
  };
}
