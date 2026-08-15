import { describe, expect, it } from 'vitest';
import {
  createBudgetLedger,
  DEFAULT_DAILY_BUDGET,
  validateDailyBudget,
  type BudgetStorageArea,
} from './budget-ledger';

function memoryStorage(initial: Record<string, unknown> = {}): BudgetStorageArea {
  const values = { ...initial };
  return {
    async get(key) {
      return key in values ? { [key]: values[key] } : {};
    },
    async set(items) {
      Object.assign(values, items);
    },
  };
}

describe('daily provider budget ledger', () => {
  it('uses the documented defaults and validates positive ranges or explicit zero', () => {
    expect(DEFAULT_DAILY_BUDGET).toEqual({
      tokenLimit: 100_000,
      estimatedCostUsdLimit: 1,
    });
    expect(validateDailyBudget({ tokenLimit: 0, estimatedCostUsdLimit: 0 })).toEqual({
      tokenLimit: 0,
      estimatedCostUsdLimit: 0,
    });
    expect(() =>
      validateDailyBudget({ tokenLimit: 9_999, estimatedCostUsdLimit: 1 }),
    ).toThrow('10,000');
    expect(() =>
      validateDailyBudget({ tokenLimit: 100_000, estimatedCostUsdLimit: 20.01 }),
    ).toThrow('20.00');
  });

  it('atomically prevents concurrent reservations from exceeding either hard limit', async () => {
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => new Date('2026-08-13T10:00:00'),
      id: (() => {
        let next = 0;
        return () => `r-${++next}`;
      })(),
    });
    await ledger.configure({ tokenLimit: 10_000, estimatedCostUsdLimit: 1 });

    const [first, second] = await Promise.all([
      ledger.reserve({ tokens: 6_000, estimatedCostUsd: 0.6 }),
      ledger.reserve({ tokens: 6_000, estimatedCostUsd: 0.6 }),
    ]);

    expect([first, second].filter((result) => result.status === 'reserved')).toHaveLength(1);
    expect([first, second].filter((result) => result.status === 'blocked')).toHaveLength(1);
  });

  it('resets at local midnight but never reopens a day after clock rollback', async () => {
    let now = new Date('2026-08-13T23:59:00');
    const ledger = createBudgetLedger(memoryStorage(), { now: () => now, id: () => 'r-1' });
    await ledger.configure({ tokenLimit: 10_000, estimatedCostUsdLimit: 1 });
    const reservation = await ledger.reserve({ tokens: 4_000, estimatedCostUsd: 0.4 });
    if (reservation.status !== 'reserved') throw new Error('Expected reservation.');
    await ledger.reconcile(reservation.reservation, {
      inputTokens: 2_000,
      cachedInputTokens: 500,
      outputTokens: 1_000,
      reasoningTokens: 250,
      totalTokens: 3_000,
      estimatedCostUsd: 0.3,
    });

    now = new Date('2026-08-14T00:01:00');
    await expect(ledger.snapshot()).resolves.toMatchObject({
      activeDate: '2026-08-14',
      used: { totalTokens: 0, estimatedCostUsd: 0 },
    });

    const nextDay = await ledger.reserve({ tokens: 6_000, estimatedCostUsd: 0.6 });
    if (nextDay.status !== 'reserved') throw new Error('Expected next-day reservation.');
    await ledger.reconcile(nextDay.reservation, {
      inputTokens: 6_000,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 6_000,
      estimatedCostUsd: 0.6,
    });
    now = new Date('2026-08-13T12:00:00');

    await expect(ledger.snapshot()).resolves.toMatchObject({
      activeDate: '2026-08-14',
      used: { totalTokens: 6_000, estimatedCostUsd: 0.6 },
    });
    await expect(
      ledger.reserve({ tokens: 5_000, estimatedCostUsd: 0.5 }),
    ).resolves.toMatchObject({ status: 'blocked', kind: 'token-budget' });
  });

  it('reconciles detailed reported usage and never releases reported usage', async () => {
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => new Date('2026-08-13T10:00:00'),
      id: () => 'r-usage',
    });
    const reserved = await ledger.reserve({ tokens: 5_000, estimatedCostUsd: 0.8 });
    if (reserved.status !== 'reserved') throw new Error('Expected reservation.');

    await ledger.reconcile(reserved.reservation, {
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 600,
      reasoningTokens: 250,
      totalTokens: 1_600,
      estimatedCostUsd: 0.35,
    });
    await ledger.release(reserved.reservation);

    await expect(ledger.snapshot()).resolves.toMatchObject({
      used: {
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 600,
        reasoningTokens: 250,
        totalTokens: 1_600,
        estimatedCostUsd: 0.35,
      },
      reserved: { tokens: 0, estimatedCostUsd: 0 },
    });
  });

  it('keeps an unknown-price custom model token-limited without fabricating cost', async () => {
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => new Date('2026-08-13T10:00:00'),
      id: () => 'r-custom',
    });
    const reserved = await ledger.reserve({
      tokens: 1_000,
      estimatedCostUsd: null,
    });
    expect(reserved).toMatchObject({
      status: 'reserved',
      reservation: { estimatedCostUsd: null },
    });
    if (reserved.status !== 'reserved') throw new Error('Expected reservation.');

    await ledger.reconcile(reserved.reservation, {
      inputTokens: 800,
      cachedInputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 50,
      totalTokens: 1_000,
      estimatedCostUsd: null,
    });

    await expect(ledger.snapshot()).resolves.toMatchObject({
      used: { totalTokens: 1_000, estimatedCostUsd: null },
    });
  });

  it('preserves known-price cost enforcement after unpriced custom-model usage', async () => {
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => new Date('2026-08-13T10:00:00'),
      id: (() => {
        let next = 0;
        return () => `r-mixed-${++next}`;
      })(),
      ownerId: 'worker-mixed',
    });
    await ledger.configure({ tokenLimit: 100_000, estimatedCostUsdLimit: 0.5 });
    const unpriced = await ledger.reserve({
      tokens: 1_000,
      estimatedCostUsd: null,
    });
    if (unpriced.status !== 'reserved') throw new Error('Expected reservation.');
    await ledger.reconcile(unpriced.reservation, {
      inputTokens: 800,
      cachedInputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 0,
      totalTokens: 1_000,
      estimatedCostUsd: null,
    });
    const priced = await ledger.reserve({
      tokens: 1_000,
      estimatedCostUsd: 0.4,
    });
    if (priced.status !== 'reserved') throw new Error('Expected reservation.');
    await ledger.reconcile(priced.reservation, {
      inputTokens: 800,
      cachedInputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 0,
      totalTokens: 1_000,
      estimatedCostUsd: 0.4,
    });

    await expect(
      ledger.reserve({ tokens: 1_000, estimatedCostUsd: 0.2 }),
    ).resolves.toMatchObject({
      status: 'blocked',
      kind: 'estimated-cost-budget',
    });
    await expect(ledger.snapshot()).resolves.toMatchObject({
      used: { estimatedCostUsd: null },
    });
  });

  it('keeps in-flight reservations across midnight and reconciles them into the active day', async () => {
    let now = new Date('2026-08-13T23:59:00');
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => now,
      id: () => 'r-midnight',
      ownerId: 'worker-midnight',
    });
    await ledger.configure({ tokenLimit: 10_000, estimatedCostUsdLimit: 1 });
    const reserved = await ledger.reserve({
      tokens: 9_000,
      estimatedCostUsd: 0.9,
    });
    if (reserved.status !== 'reserved') throw new Error('Expected reservation.');

    now = new Date('2026-08-14T00:01:00');
    await expect(ledger.snapshot()).resolves.toMatchObject({
      activeDate: '2026-08-14',
      used: { totalTokens: 0 },
      reserved: { tokens: 9_000 },
    });
    await ledger.reconcile(reserved.reservation, {
      inputTokens: 7_000,
      cachedInputTokens: 0,
      outputTokens: 1_000,
      reasoningTokens: 500,
      totalTokens: 8_000,
      estimatedCostUsd: 0.8,
    });
    await expect(ledger.snapshot()).resolves.toMatchObject({
      activeDate: '2026-08-14',
      used: { totalTokens: 8_000, estimatedCostUsd: 0.8 },
      reserved: { tokens: 0 },
    });
  });

  it('sweeps reservations left by a replaced service worker', async () => {
    const storage = memoryStorage();
    const firstWorker = createBudgetLedger(storage, {
      now: () => new Date('2026-08-13T10:00:00'),
      id: () => 'orphaned',
      ownerId: 'worker-before-restart',
    });
    await firstWorker.reserve({ tokens: 90_000, estimatedCostUsd: 0.9 });

    const replacementWorker = createBudgetLedger(storage, {
      now: () => new Date('2026-08-13T10:01:00'),
      id: () => 'replacement',
      ownerId: 'worker-after-restart',
    });
    await expect(replacementWorker.snapshot()).resolves.toMatchObject({
      used: { totalTokens: 0 },
      reserved: { tokens: 0, estimatedCostUsd: 0 },
    });
    await expect(
      replacementWorker.reserve({ tokens: 90_000, estimatedCostUsd: 0.9 }),
    ).resolves.toMatchObject({ status: 'reserved' });
  });

  it('caps background reservations at 30% while preserving foreground capacity', async () => {
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => new Date('2026-08-13T10:00:00'),
      id: (() => {
        let next = 0;
        return () => `shared-${++next}`;
      })(),
    });
    await ledger.configure({ tokenLimit: 10_000, estimatedCostUsdLimit: 1 });

    const [background, overCap, foreground] = await Promise.all([
      ledger.reserve({
        scope: 'background',
        tokens: 3_000,
        estimatedCostUsd: 0.3,
      }),
      ledger.reserve({
        scope: 'background',
        tokens: 1,
        estimatedCostUsd: 0.01,
      }),
      ledger.reserve({
        scope: 'foreground',
        tokens: 7_000,
        estimatedCostUsd: 0.7,
      }),
    ]);

    expect(background).toMatchObject({
      status: 'reserved',
      reservation: { scope: 'background' },
    });
    expect(overCap).toEqual({
      status: 'blocked',
      kind: 'token-budget',
      scope: 'background',
    });
    expect(foreground).toMatchObject({
      status: 'reserved',
      reservation: { scope: 'foreground' },
    });
    await expect(ledger.snapshot()).resolves.toMatchObject({
      reserved: { tokens: 10_000, estimatedCostUsd: 1 },
      background: {
        used: { totalTokens: 0, estimatedCostUsd: 0 },
        reserved: { tokens: 3_000, estimatedCostUsd: 0.3 },
        limit: { tokens: 3_000, estimatedCostUsd: 0.3 },
      },
    });
  });

  it('keeps unknown-price background work token-limited without fabricating cost', async () => {
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => new Date('2026-08-13T10:00:00'),
      id: () => 'background-custom-model',
    });
    await ledger.configure({ tokenLimit: 10_000, estimatedCostUsdLimit: 1 });

    await expect(
      ledger.reserve({
        scope: 'background',
        tokens: 3_000,
        estimatedCostUsd: null,
      }),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { scope: 'background', estimatedCostUsd: null },
    });
    await expect(
      ledger.reserve({
        scope: 'background',
        tokens: 1,
        estimatedCostUsd: null,
      }),
    ).resolves.toEqual({
      status: 'blocked',
      kind: 'token-budget',
      scope: 'background',
    });
  });

  it('resets reconciled background usage at the next local day', async () => {
    let now = new Date('2026-08-13T23:59:00');
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => now,
      id: (() => {
        let next = 0;
        return () => `background-day-${++next}`;
      })(),
    });
    await ledger.configure({ tokenLimit: 10_000, estimatedCostUsdLimit: 1 });
    const first = await ledger.reserve({
      scope: 'background',
      tokens: 3_000,
      estimatedCostUsd: 0.3,
    });
    if (first.status !== 'reserved') throw new Error('Expected reservation.');
    await ledger.reconcile(first.reservation, {
      inputTokens: 2_000,
      cachedInputTokens: 0,
      outputTokens: 1_000,
      reasoningTokens: 0,
      totalTokens: 3_000,
      estimatedCostUsd: 0.3,
    });
    await expect(
      ledger.reserve({
        scope: 'background',
        tokens: 1,
        estimatedCostUsd: 0.01,
      }),
    ).resolves.toMatchObject({ status: 'blocked', scope: 'background' });

    now = new Date('2026-08-14T00:01:00');
    await expect(ledger.snapshot()).resolves.toMatchObject({
      activeDate: '2026-08-14',
      background: {
        used: { totalTokens: 0, estimatedCostUsd: 0 },
        reserved: { tokens: 0, estimatedCostUsd: 0 },
      },
    });
    await expect(
      ledger.reserve({
        scope: 'background',
        tokens: 3_000,
        estimatedCostUsd: 0.3,
      }),
    ).resolves.toMatchObject({ status: 'reserved' });
  });

  it('zero in either limit explicitly disables provider Actions', async () => {
    const ledger = createBudgetLedger(memoryStorage(), {
      now: () => new Date('2026-08-13T10:00:00'),
      id: () => 'never',
    });
    await ledger.configure({ tokenLimit: 0, estimatedCostUsdLimit: 1 });
    await expect(
      ledger.reserve({ tokens: 1, estimatedCostUsd: null }),
    ).resolves.toEqual({ status: 'blocked', kind: 'provider-disabled' });
  });
});
