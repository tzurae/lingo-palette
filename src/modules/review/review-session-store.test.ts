import { describe, expect, it } from 'vitest';
import { BUNDLED_ENGLISH_EVIDENCE_PACK } from '../evidence/bundled-english-evidence-pack';
import type { ApprovedReviewItem } from './review-generation-harness';
import {
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_EVIDENCE_STORAGE_KEY,
  REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
  REVIEW_SCHEDULES_STORAGE_KEY,
  REVIEW_SESSIONS_STORAGE_KEY,
} from './review-storage-keys';
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
      targetAnswers: [`Answer for ${id}`],
      acceptableAlternativeAnswers: [`Alternative for ${id}`],
      partialAnswers: [`Partial for ${id}`],
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

function approvedDimensionItem(
  id: string,
  learningItemId: string,
  knowledgeDimension: 'usage-fit' | 'grammar-pattern',
): ApprovedReviewItem {
  const base = approvedItem(id, learningItemId);
  const relevantEvidence =
    knowledgeDimension === 'usage-fit'
      ? [...BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits]
      : [...BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns];
  return {
    ...base,
    knowledgeDimension,
    provenance: {
      ...base.provenance,
      relevantEvidence,
      sourceAuthority: {
        knowledgeDimension,
        evidence: relevantEvidence.map((entry) => ({
          evidenceId: entry.id,
          sourceId: entry.sourceId,
          sourceVersion: entry.sourceVersion,
          authority: entry.authority,
        })),
      },
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
      'targetAnswers' in
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

  it('persists evidence-first progress and never drills the same Learning Item again in one session', async () => {
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
    let nextId = 0;
    const dependencies = {
      id: () => (nextId++ === 0 ? 'session-progress' : `evidence-${nextId}`),
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

    const revealed = await store.answer('session-progress', {
      retrievalFluency: 'recalled-fluently',
      responseText: 'Answer for review-a',
    });
    expect(revealed).toMatchObject({
      status: 'revealed',
      session: {
        position: 1,
        current: {
          revealed: true,
          attemptKind: 'objective',
          reviewItemId: 'review-a',
          targetAnswers: ['Answer for review-a'],
          correctiveExplanation: 'Correction for review-a',
          evidence: {
            kind: 'objective',
            responseMethod: 'overt-response',
            judgment: 'demonstrated',
          },
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
      'Record Review Evidence for the current Review Item before advancing.',
    );
    currentTime = '2026-08-15T12:05:00.000Z';
    await resumed.answer('session-progress', {
      retrievalFluency: 'recalled-with-effort',
      responseText: 'Answer for review-b',
    });
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
      '2026-08-22T12:00:00.000Z',
      '2026-08-22T12:05:00.000Z',
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

  it('records layered evidence, applies schedule transitions, and calibrates every fourth attempt', async () => {
    const storage = memoryStorage();
    const learningItems = [
      {
        id: 'learning-calibration',
        createdAt: '2026-08-01T00:00:00.000Z',
        status: 'active' as const,
      },
    ];
    let currentTime = '2026-08-15T12:00:00.000Z';
    let nextId = 0;
    const evaluatedResponses: string[] = [];
    const store = createReviewSessionStore(storage, {
      id: () => `record-${nextId++}`,
      now: () => currentTime,
      evaluator: {
        async evaluate({ responseText }) {
          evaluatedResponses.push(responseText);
          return 'demonstrated';
        },
      },
    });
    await store.approve(
      approvedItem('review-calibration', 'learning-calibration'),
      {
        dueAt: '2026-08-15T00:00:00.000Z',
        demonstratedCount: 0,
        intervalStage: 0,
      },
    );

    const attempt = async (
      expectedKind: 'objective' | 'self-assessed',
      retrievalFluency:
        | 'did-not-recall'
        | 'recalled-with-effort'
        | 'recalled-fluently',
    ) => {
      const started = await store.start(learningItems);
      expect(started).toMatchObject({
        status: 'started',
        session: {
          current: { revealed: false, attemptKind: expectedKind },
        },
      });
      if (started.status === 'unavailable') {
        throw new Error('Expected a Review Session.');
      }
      const answered = await store.answer(started.session.id, {
        retrievalFluency,
        ...(expectedKind === 'objective'
          ? { responseText: 'Learner overt response' }
          : {}),
      });
      expect(answered).toMatchObject({
        status: 'revealed',
        session: {
          current: {
            revealed: true,
            attemptKind: expectedKind,
            evidence: {
              kind: expectedKind,
              retrievalFluency,
            },
          },
        },
      });
      await store.advance(started.session.id);
    };

    await attempt('objective', 'recalled-fluently');
    currentTime = '2026-08-18T12:00:00.000Z';
    await attempt('self-assessed', 'recalled-fluently');
    currentTime = '2026-08-21T12:00:00.000Z';
    await attempt('self-assessed', 'recalled-with-effort');
    currentTime = '2026-08-22T12:00:00.000Z';
    await attempt('self-assessed', 'recalled-fluently');
    currentTime = '2026-08-25T12:00:00.000Z';

    const calibrated = await store.start(learningItems);
    expect(calibrated).toMatchObject({
      status: 'started',
      session: {
        current: { revealed: false, attemptKind: 'objective' },
      },
    });
    expect(evaluatedResponses).toEqual(['Learner overt response']);
    expect(storage.values[REVIEW_EVIDENCE_STORAGE_KEY]).toMatchObject({
      version: 1,
      records: [
        {
          kind: 'objective',
          responseMethod: 'overt-response',
          judgment: 'demonstrated',
        },
        {
          kind: 'self-assessed',
          responseMethod: 'covert-recall',
        },
        {
          kind: 'self-assessed',
          responseMethod: 'covert-recall',
        },
        {
          kind: 'self-assessed',
          responseMethod: 'covert-recall',
        },
      ],
    });
    await expect(store.snapshot(learningItems)).resolves.toMatchObject({
      schedules: [
        {
          intervalStage: 0,
          dueAt: '2026-08-23T12:00:00.000Z',
          demonstratedCount: 1,
        },
      ],
    });
  });

  it('updates only the measured Knowledge Dimension schedule', async () => {
    const storage = memoryStorage();
    await storage.set({
      [REVIEW_SCHEDULES_STORAGE_KEY]: {
        version: 1,
        records: [
          {
            version: 1,
            learningItemId: 'learning-dimensions',
            knowledgeDimension: 'usage-fit',
            dueAt: '2026-09-01T00:00:00.000Z',
            demonstratedCount: 7,
            intervalStage: 6,
          },
        ],
      },
    });
    let nextId = 0;
    const store = createReviewSessionStore(storage, {
      id: () => `dimension-record-${nextId++}`,
      now: () => '2026-08-15T12:00:00.000Z',
    });
    await store.approve(
      approvedItem('review-dimensions', 'learning-dimensions'),
      {
        dueAt: '2026-08-15T00:00:00.000Z',
        demonstratedCount: 0,
        intervalStage: 0,
      },
    );
    const learningItems = [
      {
        id: 'learning-dimensions',
        createdAt: '2026-08-01T00:00:00.000Z',
        status: 'active' as const,
      },
    ];
    const started = await store.start(learningItems);
    if (started.status === 'unavailable') {
      throw new Error('Expected a Review Session.');
    }
    await store.answer(started.session.id, {
      retrievalFluency: 'recalled-fluently',
      responseText: 'Answer for review-dimensions',
    });

    const snapshot = await store.snapshot(learningItems);
    expect(
      snapshot.schedules.find(
        ({ knowledgeDimension }) => knowledgeDimension === 'usage-fit',
      ),
    ).toEqual({
      version: 1,
      learningItemId: 'learning-dimensions',
      knowledgeDimension: 'usage-fit',
      dueAt: '2026-09-01T00:00:00.000Z',
      demonstratedCount: 7,
      intervalStage: 6,
    });
  });

  it.each([
    ['Answer for review-judgment', 'demonstrated', 5, 3],
    ['Alternative for review-judgment', 'acceptable-alternative', 3, 2],
    ['Partial for review-judgment', 'partial', 3, 2],
    ['Distractor for review-judgment', 'not-demonstrated', 0, 2],
    ['Unknown response', 'unable-to-grade', 4, 2],
  ] as const)(
    'classifies an overt response as %s with the production evaluator',
    async (responseText, expectedJudgment, expectedStage, expectedCount) => {
      const storage = memoryStorage();
      let nextId = 0;
      const store = createReviewSessionStore(storage, {
        id: () => `judgment-record-${nextId++}`,
        now: () => '2026-08-15T12:00:00.000Z',
      });
      const baseItem = approvedItem(
        'review-judgment',
        'learning-judgment',
      );
      const item: ApprovedReviewItem = {
        ...baseItem,
        task: {
          type: 'contrastive',
          prompt: baseItem.task.prompt,
          contextQuote: baseItem.task.contextQuote,
          targetAnswers: ['Answer for review-judgment'],
          acceptableAlternativeAnswers: [
            'Alternative for review-judgment',
          ],
          partialAnswers: ['Partial for review-judgment'],
          distractors: ['Distractor for review-judgment'],
          correctiveExplanation: baseItem.task.correctiveExplanation,
        },
      };
      await store.approve(item, {
        dueAt: '2026-08-15T00:00:00.000Z',
        demonstratedCount: 2,
        intervalStage: 4,
      });
      const learningItems = [
        {
          id: 'learning-judgment',
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'active' as const,
        },
      ];
      const started = await store.start(learningItems);
      if (started.status === 'unavailable') {
        throw new Error('Expected a Review Session.');
      }

      await store.answer(started.session.id, {
        retrievalFluency: 'recalled-fluently',
        responseText,
      });
      const snapshot = await store.snapshot(learningItems);
      expect(snapshot.evidence[0]).toMatchObject({
        kind: 'objective',
        judgment: expectedJudgment,
        scheduleTransition: {
          previous: {
            dueAt: '2026-08-15T00:00:00.000Z',
            demonstratedCount: 2,
            intervalStage: 4,
          },
          next: {
            demonstratedCount: expectedCount,
            intervalStage: expectedStage,
          },
        },
      });
      expect(snapshot.evidence[0]!.scheduleTransition.previous).toEqual({
        dueAt: '2026-08-15T00:00:00.000Z',
        demonstratedCount: 2,
        intervalStage: 4,
      });
    },
  );

  it('migrates a persisted reveal-only session by accepting its first Review Evidence', async () => {
    const storage = memoryStorage();
    let nextId = 0;
    const dependencies = {
      id: () => (nextId++ === 0 ? 'legacy-session' : `legacy-evidence-${nextId}`),
      now: () => '2026-08-15T12:00:00.000Z',
    };
    const store = createReviewSessionStore(storage, dependencies);
    await store.approve(approvedItem('review-legacy', 'learning-legacy'), {
      dueAt: '2026-08-15T00:00:00.000Z',
      demonstratedCount: 0,
      intervalStage: 0,
    });
    const learningItems = [
      {
        id: 'learning-legacy',
        createdAt: '2026-08-01T00:00:00.000Z',
        status: 'active' as const,
      },
    ];
    await store.start(learningItems);
    await storage.set({
      [REVIEW_SESSIONS_STORAGE_KEY]: {
        version: 1,
        records: [
          {
            version: 1,
            id: 'legacy-session',
            status: 'active',
            startedAt: '2026-08-15T12:00:00.000Z',
            completedAt: null,
            reviewItemIds: ['review-legacy'],
            currentIndex: 0,
            revealedReviewItemIds: ['review-legacy'],
          },
        ],
      },
    });

    const resumed = createReviewSessionStore(storage, dependencies);
    await expect(resumed.snapshot(learningItems)).resolves.toMatchObject({
      activeSession: {
        current: { revealed: false, attemptKind: 'objective' },
      },
    });
    await expect(
      resumed.answer('legacy-session', {
        retrievalFluency: 'recalled-fluently',
        responseText: 'Answer for review-legacy',
      }),
    ).resolves.toMatchObject({
      status: 'revealed',
      session: {
        current: {
          revealed: true,
          evidence: { kind: 'objective', judgment: 'demonstrated' },
        },
      },
    });
  });

  it('treats persisted acceptedAnswers as alternatives without inventing target provenance', async () => {
    const storage = memoryStorage();
    const item = approvedItem('review-legacy-task', 'learning-legacy-task');
    await storage.set({
      [APPROVED_REVIEW_ITEMS_STORAGE_KEY]: {
        version: 1,
        records: [
          {
            ...item,
            task: {
              type: 'recall',
              prompt: item.task.prompt,
              contextQuote: item.task.contextQuote,
              acceptedAnswers: ['Legacy target answer'],
              correctiveExplanation: item.task.correctiveExplanation,
            },
          },
        ],
      },
      [REVIEW_SCHEDULES_STORAGE_KEY]: {
        version: 1,
        records: [
          {
            version: 1,
            learningItemId: 'learning-legacy-task',
            knowledgeDimension: 'contextual-meaning',
            dueAt: '2026-08-15T00:00:00.000Z',
            demonstratedCount: 0,
            intervalStage: 0,
          },
        ],
      },
    });
    let nextId = 0;
    const store = createReviewSessionStore(storage, {
      id: () => `legacy-task-record-${nextId++}`,
      now: () => '2026-08-15T12:00:00.000Z',
    });
    const learningItems = [
      {
        id: 'learning-legacy-task',
        createdAt: '2026-08-01T00:00:00.000Z',
        status: 'active' as const,
      },
    ];

    const started = await store.start(learningItems);
    if (started.status === 'unavailable') {
      throw new Error('Expected a Review Session.');
    }
    await expect(
      store.answer(started.session.id, {
        retrievalFluency: 'recalled-fluently',
        responseText: 'Legacy target answer',
      }),
    ).resolves.toMatchObject({
      session: {
        current: {
          targetAnswers: [],
          acceptableAlternativeAnswers: ['Legacy target answer'],
          partialAnswers: [],
          evidence: { judgment: 'acceptable-alternative' },
        },
      },
    });
  });

  it('does not persist evidence or move the schedule when objective evaluation fails', async () => {
    const storage = memoryStorage();
    let nextId = 0;
    const store = createReviewSessionStore(storage, {
      id: () => `failed-record-${nextId++}`,
      now: () => '2026-08-15T12:00:00.000Z',
      evaluator: {
        async evaluate() {
          throw new Error('Evaluator unavailable');
        },
      },
    });
    await store.approve(approvedItem('review-failed', 'learning-failed'), {
      dueAt: '2026-08-15T00:00:00.000Z',
      demonstratedCount: 0,
      intervalStage: 4,
    });
    const learningItems = [
      {
        id: 'learning-failed',
        createdAt: '2026-08-01T00:00:00.000Z',
        status: 'active' as const,
      },
    ];
    const started = await store.start(learningItems);
    if (started.status === 'unavailable') {
      throw new Error('Expected a Review Session.');
    }

    await expect(
      store.answer(started.session.id, {
        retrievalFluency: 'recalled-fluently',
        responseText: 'An answer',
      }),
    ).rejects.toThrow('Evaluator unavailable');
    await expect(store.snapshot(learningItems)).resolves.toMatchObject({
      activeSession: {
        current: { revealed: false, attemptKind: 'objective' },
      },
      schedules: [
        {
          dueAt: '2026-08-15T00:00:00.000Z',
          intervalStage: 4,
          demonstratedCount: 0,
        },
      ],
    });
    expect(storage.values[REVIEW_EVIDENCE_STORAGE_KEY]).toBeUndefined();
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

  it('selects one due dimension per Learning Item and records independent authority-pinned evidence', async () => {
    const storage = memoryStorage();
    let nextId = 0;
    const store = createReviewSessionStore(storage, {
      id: () => `dimension-evidence-${nextId++}`,
      now: () => '2026-08-15T12:00:00.000Z',
    });
    await store.approve(
      approvedDimensionItem(
        'review-grammar-a',
        'learning-a',
        'grammar-pattern',
      ),
      {
        dueAt: '2026-08-10T00:00:00.000Z',
        demonstratedCount: 2,
        intervalStage: 2,
      },
    );
    await store.approve(
      approvedDimensionItem('review-usage-a', 'learning-a', 'usage-fit'),
      {
        dueAt: '2026-08-11T00:00:00.000Z',
        demonstratedCount: 0,
        intervalStage: 5,
      },
    );
    await store.approve(
      approvedDimensionItem('review-usage-b', 'learning-b', 'usage-fit'),
      {
        dueAt: '2026-08-10T00:00:00.000Z',
        demonstratedCount: 0,
        intervalStage: 0,
      },
    );
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

    const started = await store.start(learningItems);
    expect(started).toMatchObject({
      status: 'started',
      session: {
        reviewItemIds: ['review-usage-b', 'review-grammar-a'],
        current: {
          knowledgeDimension: 'usage-fit',
          attemptKind: 'objective',
        },
      },
    });
    if (started.status === 'unavailable') {
      throw new Error('Expected a cross-dimension Review Session.');
    }
    await store.answer(started.session.id, {
      retrievalFluency: 'recalled-fluently',
      responseText: 'Answer for review-usage-b',
    });
    const advanced = await store.advance(started.session.id);
    expect(advanced).toMatchObject({
      status: 'active',
      session: {
        current: {
          knowledgeDimension: 'grammar-pattern',
          attemptKind: 'objective',
        },
      },
    });
    await store.answer(started.session.id, {
      retrievalFluency: 'recalled-with-effort',
      responseText: 'Alternative for review-grammar-a',
    });
    await store.advance(started.session.id);

    await expect(store.snapshot(learningItems)).resolves.toMatchObject({
      activeSession: null,
      schedules: expect.arrayContaining([
        expect.objectContaining({
          learningItemId: 'learning-a',
          knowledgeDimension: 'grammar-pattern',
          intervalStage: 1,
          demonstratedCount: 2,
          dueAt: '2026-08-18T12:00:00.000Z',
        }),
        expect.objectContaining({
          learningItemId: 'learning-a',
          knowledgeDimension: 'usage-fit',
          intervalStage: 5,
          demonstratedCount: 0,
          dueAt: '2026-08-11T00:00:00.000Z',
        }),
        expect.objectContaining({
          learningItemId: 'learning-b',
          knowledgeDimension: 'usage-fit',
          intervalStage: 1,
          demonstratedCount: 1,
          dueAt: '2026-08-18T12:00:00.000Z',
        }),
      ]),
      evidence: [
        {
          version: 2,
          knowledgeDimension: 'usage-fit',
          judgment: 'demonstrated',
          sourceAuthority: {
            knowledgeDimension: 'usage-fit',
          },
        },
        {
          version: 2,
          knowledgeDimension: 'grammar-pattern',
          judgment: 'acceptable-alternative',
          sourceAuthority: {
            knowledgeDimension: 'grammar-pattern',
          },
        },
      ],
    });
  });

  it('does not schedule a contextual Review Item carrying cross-dimension source authority', async () => {
    const usageItem = approvedDimensionItem(
      'review-cross-authority',
      'learning-cross-authority',
      'usage-fit',
    );
    const storage = memoryStorage();
    await storage.set({
      [APPROVED_REVIEW_ITEMS_STORAGE_KEY]: {
        version: 1,
        records: [
          {
            ...usageItem,
            knowledgeDimension: 'contextual-meaning',
          },
        ],
      },
      [REVIEW_SCHEDULES_STORAGE_KEY]: {
        version: 1,
        records: [
          {
            version: 1,
            learningItemId: 'learning-cross-authority',
            knowledgeDimension: 'contextual-meaning',
            dueAt: '2026-08-01T00:00:00.000Z',
            demonstratedCount: 0,
            intervalStage: 0,
          },
        ],
      },
    });
    const store = createReviewSessionStore(storage, {
      id: () => 'cross-authority-session',
      now: () => '2026-08-15T12:00:00.000Z',
    });
    await expect(
      store.start([
        {
          id: 'learning-cross-authority',
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'active',
        },
      ]),
    ).rejects.toThrow(
      'Review Item source authority must match its Knowledge Dimension.',
    );
  });
});
