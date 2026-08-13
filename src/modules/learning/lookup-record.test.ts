import { describe, expect, it } from 'vitest';
import { createLookupRecordStore } from './lookup-record';

const selection = {
  text: 'postpone',
  context: {
    before: 'The committee decided to ',
    after: ' the vote.',
  },
};

function memoryStorage(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key: string) {
      return { [key]: values[key] };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, structuredClone(items));
    },
  };
}

describe('Lookup Record store', () => {
  it('durably appends one versioned Quick Hint Lookup Record with a sanitized source URL', async () => {
    const storage = memoryStorage();
    const store = createLookupRecordStore(storage, {
      id: () => '018f47c0-8a9b-7c6d-8e5f-123456789abc',
      now: () => '2026-08-13T23:00:00.000Z',
    });

    const record = await store.append({
      selection,
      action: {
        type: 'quick-hint',
        result: {
          simplerExpression: 'delay until later',
          explanationCue: '延後',
        },
      },
      usage: {
        source: 'provider',
        attempts: 1,
        provider: {
          inputTokens: 40,
          cachedInputTokens: 0,
          outputTokens: 8,
          reasoningTokens: 0,
          totalTokens: 48,
          estimatedCostUsd: 0.00001,
        },
      },
      sourceUrl: 'https://learner:secret@example.test/article?id=private#selection',
    });

    expect(record).toEqual({
      version: 1,
      id: '018f47c0-8a9b-7c6d-8e5f-123456789abc',
      selection,
      action: {
        type: 'quick-hint',
        result: {
          simplerExpression: 'delay until later',
          explanationCue: '延後',
        },
      },
      completedAt: '2026-08-13T23:00:00.000Z',
      usage: {
        source: 'provider',
        attempts: 1,
        provider: {
          inputTokens: 40,
          cachedInputTokens: 0,
          outputTokens: 8,
          reasoningTokens: 0,
          totalTokens: 48,
          estimatedCostUsd: 0.00001,
        },
      },
      sourceUrl: 'https://example.test/article',
    });

    const reloaded = createLookupRecordStore(storage);
    await expect(reloaded.list()).resolves.toEqual([record]);
  });

  it('serializes concurrent completions without losing either Lookup Record', async () => {
    const storage = memoryStorage();
    let nextId = 0;
    const store = createLookupRecordStore(storage, {
      id: () => `record-${(nextId += 1)}`,
      now: () => '2026-08-13T23:00:00.000Z',
    });
    const completed = {
      action: {
        type: 'quick-hint' as const,
        result: {
          simplerExpression: 'delay until later',
          explanationCue: null,
        },
      },
      usage: {
        source: 'cache' as const,
        attempts: 0,
        provider: null,
      },
    };

    await Promise.all([
      store.append({ ...completed, selection }),
      store.append({
        ...completed,
        selection: { ...selection, text: 'vote' },
      }),
    ]);

    await expect(store.list()).resolves.toMatchObject([
      { id: 'record-2', selection: { text: 'vote' } },
      { id: 'record-1', selection: { text: 'postpone' } },
    ]);
  });

  it('rejects malformed durable data without overwriting existing history', async () => {
    const malformed = {
      lookupRecordsV1: {
        version: 99,
        records: [{ learnerData: 'must survive inspection' }],
      },
    };
    const storage = memoryStorage(malformed);
    const store = createLookupRecordStore(storage);

    await expect(
      store.append({
        selection,
        action: {
          type: 'quick-hint',
          result: {
            simplerExpression: 'delay until later',
            explanationCue: null,
          },
        },
        usage: {
          source: 'cache',
          attempts: 0,
          provider: null,
        },
      }),
    ).rejects.toThrow('existing data was not changed');
    expect(storage.values).toEqual(malformed);
  });
});
