import { describe, expect, it } from 'vitest';
import {
  createDogfoodActivityStore,
  countSelectionSentences,
  DOGFOOD_ACTIVITY_STORAGE_KEY,
} from './activity-store';

function memoryStorage(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key: string) {
      return key in values ? { [key]: structuredClone(values[key]) } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, structuredClone(items));
    },
  };
}

describe('dogfood activity store', () => {
  it('records only privacy-safe activity while collection is enabled', async () => {
    const storage = memoryStorage();
    const instants = [
      { occurredAt: '2026-08-11T09:00:00.000Z', localDate: '2026-08-11' },
      { occurredAt: '2026-08-11T09:01:00.000Z', localDate: '2026-08-11' },
      { occurredAt: '2026-08-11T09:02:00.000Z', localDate: '2026-08-11' },
      { occurredAt: '2026-08-11T09:03:00.000Z', localDate: '2026-08-11' },
    ];
    const ids = ['run-1', 'event-selection', 'event-playback'];
    const store = createDogfoodActivityStore(storage, {
      clock: () => instants.shift()!,
      id: () => ids.shift()!,
    });

    await expect(
      store.record({ kind: 'selection', origin: 'https://reading.example' }),
    ).resolves.toBeNull();
    await store.start();
    await store.record({ kind: 'selection', origin: 'https://reading.example' });
    await store.record({
      kind: 'pronunciation-playback-completed',
      origin: 'https://reading.example',
      variety: 'en-GB',
      sentenceCount: 2,
    });
    await store.pause();
    await expect(
      store.record({ kind: 'selection', origin: 'https://ignored.example' }),
    ).resolves.toBeNull();

    expect(await store.snapshot()).toEqual({
      version: 1,
      runId: 'run-1',
      enabled: false,
      startedAt: '2026-08-11T09:00:00.000Z',
      startedLocalDate: '2026-08-11',
      events: [
        {
          version: 1,
          id: 'event-selection',
          kind: 'selection',
          occurredAt: '2026-08-11T09:01:00.000Z',
          localDate: '2026-08-11',
          origin: 'https://reading.example',
        },
        {
          version: 1,
          id: 'event-playback',
          kind: 'pronunciation-playback-completed',
          occurredAt: '2026-08-11T09:02:00.000Z',
          localDate: '2026-08-11',
          origin: 'https://reading.example',
          variety: 'en-GB',
          sentenceCount: 2,
        },
      ],
    });
    expect(JSON.stringify(storage.values[DOGFOOD_ACTIVITY_STORAGE_KEY])).not.toContain(
      'Selection text',
    );
    expect(countSelectionSentences('First sentence. Second sentence!')).toBe(2);
  });

  it('preserves concurrent learning, review, and recovery activity', async () => {
    const storage = memoryStorage();
    let minute = 0;
    let nextId = 0;
    const store = createDogfoodActivityStore(storage, {
      clock: () => ({
        occurredAt: `2026-08-12T09:${String(minute++).padStart(2, '0')}:00.000Z`,
        localDate: '2026-08-12',
      }),
      id: () => `id-${nextId++}`,
    });
    await store.start();

    await Promise.all([
      store.record({
        kind: 'learning-item-saved',
        learningItemId: 'learning-1',
        origin: 'https://one.example/path?private=true',
      }),
      store.record({
        kind: 'review-session-completed',
        reviewSessionId: 'session-1',
      }),
      store.record({
        kind: 'portable-backup-exported',
        backupFilename: 'lingo-palette-backup-2026-08-12.json',
      }),
      store.record({
        kind: 'portable-backup-imported',
        importReportId: 'report-1',
      }),
    ]);

    expect((await store.snapshot())?.events).toMatchObject([
      {
        kind: 'learning-item-saved',
        learningItemId: 'learning-1',
        origin: 'https://one.example',
      },
      {
        kind: 'review-session-completed',
        reviewSessionId: 'session-1',
      },
      {
        kind: 'portable-backup-exported',
        backupFilename: 'lingo-palette-backup-2026-08-12.json',
      },
      {
        kind: 'portable-backup-imported',
        importReportId: 'report-1',
      },
    ]);
  });

  it('continues collecting after one invalid activity is rejected', async () => {
    const storage = memoryStorage();
    let nextId = 0;
    const store = createDogfoodActivityStore(storage, {
      clock: () => ({
        occurredAt: '2026-08-12T09:00:00.000Z',
        localDate: '2026-08-12',
      }),
      id: () => `id-${nextId++}`,
    });
    await store.start();
    await expect(
      store.record({ kind: 'selection', origin: 'file:///private/reading' }),
    ).rejects.toThrow('Dogfood activity origins must use HTTP(S).');

    await expect(
      store.record({ kind: 'selection', origin: 'https://reading.example' }),
    ).resolves.toMatchObject({
      kind: 'selection',
      origin: 'https://reading.example',
    });
  });
});
