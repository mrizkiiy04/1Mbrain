/**
 * Source Ledger
 *
 * Prevents re-ingesting the same URL/page twice.
 * Uses a simple in-memory Map backed by a JSON file for persistence.
 *
 * The deduplication key is sourceHash = SHA-256(url + textContent).
 * This means:
 * - Same URL with different content → re-ingest (page updated)
 * - Same URL with same content → skip (already ingested)
 * - Different URL with same content → skip (duplicate content)
 *
 * For production, this can be replaced with a Redis or SQLite-backed store.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { SourceLedgerEntry } from './types.js';

const LEDGER_DIR = process.env['INGEST_LEDGER_DIR'] ?? '.1mbrain-ingest';
const LEDGER_FILE = 'source-ledger.json';

export class SourceLedger {
  private entries = new Map<string, SourceLedgerEntry>();
  private loaded = false;
  private readonly ledgerPath: string;

  constructor(ledgerDir: string = LEDGER_DIR) {
    this.ledgerPath = join(ledgerDir, LEDGER_FILE);
  }

  /**
   * Load ledger from disk (lazy — called on first access).
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.ledgerPath, 'utf8');
      const parsed = JSON.parse(raw) as SourceLedgerEntry[];
      for (const entry of parsed) {
        this.entries.set(entry.sourceHash, entry);
      }
    } catch {
      // File doesn't exist yet — start fresh
    }
  }

  /**
   * Save current ledger to disk.
   */
  private async persist(): Promise<void> {
    try {
      const dir = join(this.ledgerPath, '..');
      await mkdir(dir, { recursive: true });
      const data = JSON.stringify([...this.entries.values()], null, 2);
      await writeFile(this.ledgerPath, data, 'utf8');
    } catch {
      // Non-fatal — in-memory state is still correct
    }
  }

  /**
   * Check if a sourceHash has already been ingested.
   */
  async hasSeen(sourceHash: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.entries.has(sourceHash);
  }

  /**
   * Get ledger entry for a sourceHash.
   */
  async getEntry(sourceHash: string): Promise<SourceLedgerEntry | null> {
    await this.ensureLoaded();
    return this.entries.get(sourceHash) ?? null;
  }

  /**
   * Mark a sourceHash as ingested.
   */
  async markSeen(
    sourceHash: string,
    data: { url: string; title: string; factCount: number },
  ): Promise<void> {
    await this.ensureLoaded();

    const entry: SourceLedgerEntry = {
      sourceHash,
      url: data.url,
      title: data.title,
      storedAt: new Date().toISOString(),
      factCount: data.factCount,
    };

    this.entries.set(sourceHash, entry);
    await this.persist();
  }

  /**
   * Remove an entry (force re-ingest on next run).
   */
  async forget(sourceHash: string): Promise<void> {
    await this.ensureLoaded();
    this.entries.delete(sourceHash);
    await this.persist();
  }

  /**
   * Total number of tracked sources.
   */
  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.entries.size;
  }
}

// ─── Singleton factory ─────────────────────────────────────

let _defaultLedger: SourceLedger | null = null;

export function getDefaultLedger(): SourceLedger {
  if (!_defaultLedger) {
    _defaultLedger = new SourceLedger();
  }
  return _defaultLedger;
}

export function setDefaultLedger(ledger: SourceLedger): void {
  _defaultLedger = ledger;
}
