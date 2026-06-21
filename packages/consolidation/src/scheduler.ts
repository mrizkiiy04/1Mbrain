import type { DatabaseProvider, EventBus, MemoryEvent, MemoryEngine } from '@1mbrain/core';
import { createChildLogger } from '@1mbrain/core';
import { ConsolidationEngine } from './consolidation-engine.js';
import { MemoryClusterer } from './memory-clusterer.js';
import {
  type ConsolidationOptions,
  resolveConsolidationOptions,
} from './types.js';

const log = createChildLogger('consolidation-scheduler');

interface ConsolidationRunner {
  run(agentId: string, input?: ConsolidationOptions & { triggerReason?: 'sleep-cycle' | 'threshold' }): Promise<unknown>;
}

interface CandidateCounter {
  findCandidates(agentId: string, options?: ConsolidationOptions): Promise<unknown[]>;
}

export class ConsolidationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly lastThresholdRun = new Map<string, number>();
  private readonly options: ReturnType<typeof resolveConsolidationOptions>;

  constructor(
    private readonly consolidationEngine: ConsolidationRunner,
    private readonly db: DatabaseProvider,
    private readonly eventBus: EventBus,
    options: ConsolidationOptions = {},
    private readonly clusterer: CandidateCounter = new MemoryClusterer(db),
  ) {
    this.options = resolveConsolidationOptions(options);
  }

  start(): void {
    if (!this.options.enabled) {
      log.info('Consolidation scheduler disabled');
      return;
    }

    this.unsubscribe = this.eventBus.subscribe((event) => {
      void this.handleEvent(event);
    });
    this.scheduleNextSleepCycle();
    log.info({ cron: this.options.cron }, 'Consolidation scheduler started');
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async runSleepCycle(): Promise<void> {
    const agentIds = await this.db.listAgentIds();
    for (const agentId of agentIds) {
      await this.consolidationEngine.run(agentId, {
        ...this.options,
        triggerReason: 'sleep-cycle',
      });
    }
  }

  async checkThreshold(agentId: string): Promise<boolean> {
    const now = Date.now();
    const lastRun = this.lastThresholdRun.get(agentId) ?? 0;
    if (now - lastRun < this.options.debounceMs) {
      return false;
    }

    const candidates = await this.clusterer.findCandidates(agentId, this.options);
    if (candidates.length < this.options.threshold) {
      return false;
    }

    this.lastThresholdRun.set(agentId, now);
    await this.consolidationEngine.run(agentId, {
      ...this.options,
      triggerReason: 'threshold',
    });
    return true;
  }

  private async handleEvent(event: MemoryEvent): Promise<void> {
    if (event.type !== 'memory:created' || event.memoryType !== 'episodic') {
      return;
    }

    try {
      await this.checkThreshold(event.agentId);
    } catch (err) {
      log.warn({ err, agentId: event.agentId }, 'Threshold consolidation check failed');
    }
  }

  private scheduleNextSleepCycle(): void {
    const delay = millisecondsUntilNextRun(this.options.cron, new Date());
    this.timer = setTimeout(async () => {
      try {
        await this.runSleepCycle();
      } catch (err) {
        log.error({ err }, 'Sleep-cycle consolidation failed');
      } finally {
        this.scheduleNextSleepCycle();
      }
    }, delay);
  }
}

export function createConsolidationScheduler(
  memoryEngine: MemoryEngine,
  db: DatabaseProvider,
  eventBus: EventBus,
  options: ConsolidationOptions = {},
): ConsolidationScheduler {
  return new ConsolidationScheduler(
    new ConsolidationEngine(memoryEngine, db, eventBus),
    db,
    eventBus,
    options,
  );
}

export function millisecondsUntilNextRun(cron: string, now: Date): number {
  const [minutePart, hourPart] = cron.trim().split(/\s+/);
  const minute = parseCronNumber(minutePart, 0, 59, 0);
  const hour = parseCronNumber(hourPart, 0, 23, 2);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

function parseCronNumber(value: string | undefined, min: number, max: number, fallback: number): number {
  if (!value || value === '*') return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}
