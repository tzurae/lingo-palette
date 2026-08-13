import { describe, expect, it } from 'vitest';
import type { DeepDiveResult } from './deep-dive';
import {
  createDeepDiveStateStore,
  type DeepDiveStateStorage,
} from './deep-dive-state';

const selection = {
  text: 'postpone',
  context: { before: 'The committee decided to ', after: ' the vote.' },
};
const replacementSelection = {
  text: 'deliberately',
  context: { before: 'The learner can ', after: ' promote one Selection.' },
};
const result: DeepDiveResult = {
  contextualMeaning: 'Delay an event until a later time.',
  usageFit: 'Neutral wording suitable for a committee decision.',
  grammarPattern: {
    pattern: 'postpone + noun / gerund',
    explanation: 'The complement names the delayed event.',
  },
  alternatives: [
    { expression: 'put off', distinction: 'More conversational.' },
  ],
  examples: [
    {
      sentence: 'They postponed the vote.',
      explanation: 'The delayed event is a noun phrase.',
    },
  ],
};

function memoryStorage(): DeepDiveStateStorage {
  const values: Record<string, unknown> = {};
  return {
    async get(key) {
      return key in values ? { [key]: values[key] } : {};
    },
    async set(items) {
      Object.assign(values, items);
    },
  };
}

describe('Side Panel Current state store', () => {
  it('replaces Current only when the matching explicit Deep Dive completes', async () => {
    const store = createDeepDiveStateStore(memoryStorage(), {
      id: (() => {
        let next = 0;
        return () => `deep-dive-${++next}`;
      })(),
      now: () => '2026-08-13T14:00:00.000Z',
    });

    const first = await store.begin(selection);
    await store.settle(first.id, { status: 'completed', result });
    const second = await store.begin(replacementSelection);

    await expect(store.load()).resolves.toMatchObject({
      current: { selection, result },
      request: { id: second.id, selection: replacementSelection, status: 'working' },
    });

    await store.settle(first.id, {
      status: 'completed',
      result: { ...result, contextualMeaning: 'stale result' },
    });
    await expect(store.load()).resolves.toMatchObject({
      current: { selection, result },
      request: { id: second.id, status: 'working' },
    });

    await store.settle(second.id, {
      status: 'completed',
      result: { ...result, contextualMeaning: 'Intentional replacement.' },
    });
    await expect(store.load()).resolves.toMatchObject({
      current: {
        selection: replacementSelection,
        result: { contextualMeaning: 'Intentional replacement.' },
      },
      request: null,
    });
  });

  it.each([
    { status: 'failed' as const, message: 'OpenAI authentication failed.' },
    { status: 'cancelled' as const, message: 'Deep Dive cancelled.' },
  ])('preserves Current and the retryable Selection after $status', async (outcome) => {
    const store = createDeepDiveStateStore(memoryStorage(), {
      id: (() => {
        let next = 0;
        return () => `request-${++next}`;
      })(),
      now: () => '2026-08-13T14:00:00.000Z',
    });
    const completed = await store.begin(selection);
    await store.settle(completed.id, { status: 'completed', result });
    const pending = await store.begin(replacementSelection);
    await store.settle(pending.id, outcome);

    await expect(store.load()).resolves.toMatchObject({
      current: { selection, result },
      request: {
        id: pending.id,
        selection: replacementSelection,
        status: outcome.status,
        message: outcome.message,
      },
    });
  });

  it('lets an explicit cancellation beat a concurrent completion', async () => {
    const store = createDeepDiveStateStore(memoryStorage(), {
      id: () => 'cancellation-race',
      now: () => '2026-08-13T14:00:00.000Z',
    });
    const request = await store.begin(selection);

    const completion = store.settle(request.id, {
      status: 'completed',
      result,
    });
    const cancellation = store.cancel(
      request.id,
      '已取消 Deep Dive；Selection 仍保留。',
    );
    await Promise.all([completion, cancellation]);

    await expect(store.load()).resolves.toMatchObject({
      current: null,
      request: {
        id: request.id,
        selection,
        status: 'cancelled',
      },
    });
  });

  it('turns service-worker-interrupted work into an explicit retry state', async () => {
    const storage = memoryStorage();
    const firstWorker = createDeepDiveStateStore(storage, {
      id: () => 'interrupted-request',
      now: () => '2026-08-13T14:00:00.000Z',
    });
    await firstWorker.begin(selection);

    const replacementWorker = createDeepDiveStateStore(storage, {
      id: () => 'retry-request',
      now: () => '2026-08-13T14:01:00.000Z',
    });
    await replacementWorker.interruptRunning();

    await expect(replacementWorker.load()).resolves.toMatchObject({
      current: null,
      request: {
        id: 'interrupted-request',
        selection,
        status: 'failed',
        message: expect.stringContaining('中斷'),
      },
    });
  });
});
