import { describe, expect, it, vi } from 'vitest';
import type { DatabaseProvider, EventBus } from '@1mbrain/core';
import { ConsolidationScheduler, millisecondsUntilNextRun } from '../src/scheduler.js';

describe('ConsolidationScheduler', () => {
  it('computes the next 02:00 sleep-cycle run', () => {
    const delay = millisecondsUntilNextRun('0 2 * * *', new Date(2026, 5, 18, 1, 30, 0, 0));
    expect(delay).toBe(30 * 60 * 1000);
  });

  it('runs sleep cycle for all listed agents', async () => {
    const consolidationEngine = { run: vi.fn(async () => undefined) };
    const scheduler = new ConsolidationScheduler(
      consolidationEngine,
      { listAgentIds: async () => ['a1', 'a2'] } as unknown as DatabaseProvider,
      fakeEventBus(),
    );

    await scheduler.runSleepCycle();

    expect(consolidationEngine.run).toHaveBeenCalledTimes(2);
    expect(consolidationEngine.run).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ triggerReason: 'sleep-cycle' }),
    );
  });

  it('fires threshold consolidation and debounces repeated triggers', async () => {
    const consolidationEngine = { run: vi.fn(async () => undefined) };
    const scheduler = new ConsolidationScheduler(
      consolidationEngine,
      {} as DatabaseProvider,
      fakeEventBus(),
      { threshold: 3, debounceMs: 5 * 60 * 1000 },
      { findCandidates: async () => [{}, {}, {}] },
    );

    await expect(scheduler.checkThreshold('agent-1')).resolves.toBe(true);
    await expect(scheduler.checkThreshold('agent-1')).resolves.toBe(false);
    expect(consolidationEngine.run).toHaveBeenCalledTimes(1);
  });
});

function fakeEventBus(): EventBus {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
    close: vi.fn(),
  } as unknown as EventBus;
}
