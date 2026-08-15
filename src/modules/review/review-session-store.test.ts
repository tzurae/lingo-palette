import { describe, expect, it } from 'vitest';
import { BUNDLED_ENGLISH_EVIDENCE_PACK } from '../evidence/bundled-english-evidence-pack';
import type { ApprovedReviewItem } from './review-generation-harness';
import { REVIEW_REVALIDATION_MARKERS_STORAGE_KEY } from './review-storage-keys';
import { createReviewSessionStore } from './review-session-store';

function memoryStorage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    async get(key: string) {
      return { [key]: structuredClone(values[key]) };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, structuredClone(items));
    },
  };
}

function approvedItem(
  id: string,
  learningItemId: string,
): ApprovedReviewItem {
  return {
    version: 1,
    id,
    learningItemId,
    knowledgeDimension: 'contextual-meaning',
    task: {
      type: 'recall',
      prompt: `Retrieve ${id}`,
      contextQuote: `Context for ${id}`,
      acceptedAnswers: [`Answer for ${id}`],
      correctiveExplanation: `Correction for ${id}`,
    },
    provenance: {
      approvedAt: '2026-08-14T00:00:00.000Z',
      generation: { model: 'gpt-test', promptVersion: 'review-v1' },
      validatorVersion: 'validator-v1',
      evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
      relevantEvidence: [...BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings],
      licenseAndAttribution:
        BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution,
      validation: { outcome: 'approved', reasons: [] },
    },
  };
}

describe('Review Session store', () => {
  it('selects the first five unique due Learning Items by the deterministic rank', async () => {
    const storage = memoryStorage();
    const store = createReviewSessionStore(storage, {
      id: () => 'session-1',
      now: () => '2026-08-15T12:00:00.000Z',
    });
    const approvals = [
      ['review-a', 'learning-z', '2026-08-10T00:00:00.000Z', 9, 8],
      ['review-b', 'learning-y', '2026-08-11T00:00:00.000Z', 0, 7],
      ['review-c1', 'learning-x', '2026-08-11T00:00:00.000Z', 1, 0],
      ['review-c0', 'learning-x', '2026-08-11T00:00:00.000Z', 1, 0],
      ['review-d', 'learning-w', '2026-08-11T00:00:00.000Z', 1, 1],
      ['review-e', 'learning-a', '2026-08-11T00:00:00.000Z', 1, 1],
      ['review-f', 'learning-b', '2026-08-11T00:00:00.000Z', 1, 1],
      ['review-future', 'learning-future', '2026-08-16T00:00:00.000Z', 0, 0],
    ] as const;
    for (const [reviewItemId, learningItemId, dueAt, demonstratedCount, stage] of approvals) {
      await store.approve(approvedItem(reviewItemId, learningItemId), {
        dueAt,
        demonstratedCount,
        intervalStage: stage,
      });
    }
    const learningItems = [
      { id: 'learning-z', createdAt: '2026-08-10T00:00:00.000Z', status: 'active' as const },
      { id: 'learning-y', createdAt: '2026-08-10T00:00:00.000Z', status: 'active' as const },
      { id: 'learning-x', createdAt: '2026-08-10T00:00:00.000Z', status: 'active' as const },
      { id: 'learning-w', createdAt: '2026-08-09T00:00:00.000Z', status: 'active' as const },
      { id: 'learning-a', createdAt: '2026-08-10T00:00:00.000Z', status: 'active' as const },
      { id: 'learning-b', createdAt: '2026-08-10T00:00:00.000Z', status: 'active' as const },
      { id: 'learning-future', createdAt: '2026-08-01T00:00:00.000Z', status: 'active' as const },
    ];

    const result = await store.start(learningItems);

    expect(result).toMatchObject({
      status: 'started',
      session: {
        id: 'session-1',
        total: 5,
        shortened: false,
        reviewItemIds: [
          'review-a',
          'review-b',
          'review-c0',
          'review-d',
          'review-e',
        ],
      },
    });
  });

  it('starts an explicitly shortened session, exposes per-dimension intervals, and does not start at zero', async () => {
    const storage = memoryStorage();
    const store = createReviewSessionStore(storage, {
      id: () => 'short-session',
      now: () => '2026-08-15T12:00:00.000Z',
    });
    const learningItems = Array.from({ length: 4 }, (_, index) => ({
      id: `learning-${index + 1}`,
      createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      status: 'active' as const,
    }));
    for (const [index, learningItem] of learningItems.entries()) {
      await store.approve(
        approvedItem(`review-${index + 1}`, learningItem.id),
        {
          dueAt: '2026-08-15T00:00:00.000Z',
          demonstratedCount: index,
          intervalStage: index,
        },
      );
    }

    const started = await store.start(learningItems);
    const snapshot = await store.snapshot(learningItems);

    expect(started).toMatchObject({
      status: 'started',
      session: {
        total: 4,
        shortened: true,
        current: {
          revealed: false,
          reviewItemId: 'review-1',
          prompt: 'Retrieve review-1',
          contextQuote: 'Context for review-1',
        },
      },
    });
    expect(
      'acceptedAnswers' in
        (started.status === 'started' ? started.session.current! : {}),
    ).toBe(false);
    expect(snapshot.schedules).toMatchObject([
      {
        learningItemId: 'learning-1',
        knowledgeDimension: 'contextual-meaning',
        dueAt: '2026-08-15T00:00:00.000Z',
        intervalStage: 0,
      },
      {
        learningItemId: 'learning-2',
        knowledgeDimension: 'contextual-meaning',
        intervalStage: 1,
      },
      {
        learningItemId: 'learning-3',
        knowledgeDimension: 'contextual-meaning',
        intervalStage: 2,
      },
      {
        learningItemId: 'learning-4',
        knowledgeDimension: 'contextual-meaning',
        intervalStage: 3,
      },
    ]);
    expect(snapshot.activeSession).toMatchObject({
      id: 'short-session',
      total: 4,
    });

    const emptyStore = createReviewSessionStore(memoryStorage(), {
      now: () => '2026-08-15T12:00:00.000Z',
    });
    await expect(emptyStore.start(learningItems)).resolves.toEqual({
      status: 'unavailable',
      eligibleCount: 0,
    });
    await expect(emptyStore.snapshot(learningItems)).resolves.toMatchObject({
      eligibleCount: 0,
      activeSession: null,
      schedules: [],
    });
  });

  it('persists reveal-first progress and never drills the same Learning Item again in one session', async () => {
    const storage = memoryStorage();
    const learningItems = [
      {
        id: 'learning-a',
        createdAt: '2026-08-01T00:00:00.000Z',
        status: 'active' as const,
      },
      {
        id: 'learning-b',
        createdAt: '2026-08-02T00:00:00.000Z',
        status: 'active' as const,
      },
    ];
    let currentTime = '2026-08-15T12:00:00.000Z';
    const dependencies = {
      id: () => 'session-progress',
      now: () => currentTime,
    };
    const store = createReviewSessionStore(storage, dependencies);
    await store.approve(approvedItem('review-a', 'learning-a'), {
      dueAt: '2026-08-10T00:00:00.000Z',
      demonstratedCount: 0,
      intervalStage: 1,
    });
    await store.approve(approvedItem('review-b', 'learning-b'), {
      dueAt: '2026-08-11T00:00:00.000Z',
      demonstratedCount: 0,
      intervalStage: 1,
    });
    await store.start(learningItems);

    const revealed = await store.reveal('session-progress');
    expect(revealed).toMatchObject({
      status: 'revealed',
      session: {
        position: 1,
        current: {
          revealed: true,
          reviewItemId: 'review-a',
          acceptedAnswers: ['Answer for review-a'],
          correctiveExplanation: 'Correction for review-a',
        },
      },
    });

    const resumed = createReviewSessionStore(storage, dependencies);
    await expect(resumed.snapshot(learningItems)).resolves.toMatchObject({
      activeSession: {
        position: 1,
        current: { revealed: true, reviewItemId: 'review-a' },
      },
    });
    await expect(resumed.advance('session-progress')).resolves.toMatchObject({
      status: 'active',
      session: {
        position: 2,
        current: { revealed: false, reviewItemId: 'review-b' },
      },
    });
    await expect(resumed.advance('session-progress')).rejects.toThrow(
      'Reveal the current Review Item before advancing.',
    );
    await resumed.reveal('session-progress');
    currentTime = '2026-08-15T12:05:00.000Z';
    await expect(resumed.advance('session-progress')).resolves.toMatchObject({
      status: 'completed',
      session: {
        status: 'completed',
        position: 2,
        current: null,
      },
    });

    const completed = await resumed.snapshot(learningItems);
    expect(completed.activeSession).toBeNull();
    expect(completed.schedules.map(({ dueAt }) => dueAt)).toEqual([
      '2026-08-10T00:00:00.000Z',
      '2026-08-11T00:00:00.000Z',
    ]);
  });

  it('excludes merged Learning Items and Review Items awaiting Evidence Pack revalidation', async () => {
    const storage = memoryStorage();
    const store = createReviewSessionStore(storage, {
      now: () => '2026-08-15T12:00:00.000Z',
    });
    await store.approve(approvedItem('review-pending', 'learning-active'), {
      dueAt: '2026-08-10T00:00:00.000Z',
      demonstratedCount: 0,
      intervalStage: 0,
    });
    await store.approve(approvedItem('review-merged', 'learning-merged'), {
      dueAt: '2026-08-10T00:00:00.000Z',
      demonstratedCount: 0,
      intervalStage: 0,
    });
    await storage.set({
      [REVIEW_REVALIDATION_MARKERS_STORAGE_KEY]: {
        version: 1,
        records: {
          'sweep:review-pending': {
            reviewItemId: 'review-pending',
            status: 'pending',
          },
        },
      },
    });

    await expect(
      store.start([
        {
          id: 'learning-active',
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'active',
        },
        {
          id: 'learning-merged',
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'merged',
        },
      ]),
    ).resolves.toEqual({ status: 'unavailable', eligibleCount: 0 });
  });

  it('preserves an established dimension schedule when approval is repeated', async () => {
    const storage = memoryStorage();
    const store = createReviewSessionStore(storage, {
      now: () => '2026-08-15T00:00:00.000Z',
    });
    const item = approvedItem('review-existing', 'learning-existing');
    await store.approve(item, {
      dueAt: '2026-09-14T00:00:00.000Z',
      demonstratedCount: 4,
      intervalStage: 4,
    });

    await store.approve(item, {
      dueAt: '2026-08-15T00:00:00.000Z',
      demonstratedCount: 0,
      intervalStage: 0,
    });

    await expect(
      store.snapshot([
        {
          id: 'learning-existing',
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'active',
        },
      ]),
    ).resolves.toMatchObject({
      eligibleCount: 0,
      schedules: [
        {
          dueAt: '2026-09-14T00:00:00.000Z',
          demonstratedCount: 4,
          intervalStage: 4,
        },
      ],
    });
  });

  it('compares equivalent ISO datetime representations by instant', async () => {
    const store = createReviewSessionStore(memoryStorage(), {
      id: () => 'equivalent-time-session',
      now: () => '2026-08-15T00:00:00.000Z',
    });
    await store.approve(approvedItem('review-due-now', 'learning-due-now'), {
      dueAt: '2026-08-15T00:00:00Z',
      demonstratedCount: 0,
      intervalStage: 0,
    });

    await expect(
      store.start([
        {
          id: 'learning-due-now',
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'active',
        },
      ]),
    ).resolves.toMatchObject({
      status: 'started',
      session: { reviewItemIds: ['review-due-now'] },
    });
  });
});
