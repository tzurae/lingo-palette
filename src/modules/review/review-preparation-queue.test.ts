import { describe, expect, it } from 'vitest';
import type { ProviderUsage } from '../openai/budget-ledger';
import { BUNDLED_ENGLISH_EVIDENCE_PACK } from '../evidence/bundled-english-evidence-pack';
import type { ApprovedReviewItem } from './review-generation-harness';
import {
  createReviewPreparationQueue,
  REVIEW_PREPARATION_JOBS_STORAGE_KEY,
  ReviewPreparationFailure,
  type ReviewPreparationStorage,
  type ReviewPreparationTarget,
} from './review-preparation-queue';

function memoryStorage(
  initial: Record<string, unknown> = {},
): ReviewPreparationStorage {
  const values = structuredClone(initial);
  return {
    async get(key) {
      return { [key]: structuredClone(values[key]) };
    },
    async set(items) {
      Object.assign(values, structuredClone(items));
    },
  };
}

const context = {
  learningItem: {
    id: 'learning-1',
    expression: 'postpone',
    normalizedExpression: 'postpone',
    status: 'active' as const,
    sensePin: {
      evidencePackVersion:
        BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.version,
      sourceSenseId: 'oewn:02648898-v',
      morphology: 'base-form:postpone',
      partOfSpeech: 'verb',
    },
    productiveUseIntent: false,
  },
  encounters: [
    {
      id: 'encounter-1',
      learningItemId: 'learning-1',
      selection: {
        text: 'postpone',
        context: { before: "Let's ", after: ' the exam.' },
      },
      sensePin: {
        evidencePackVersion:
          BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.version,
        sourceSenseId: 'oewn:02648898-v',
        morphology: 'base-form:postpone',
        partOfSpeech: 'verb',
      },
    },
  ],
  generation: {
    model: 'gpt-5-mini-2026-03-17',
    promptVersion: 'review-prompt-v1',
  },
};

function target(
  overrides: Partial<ReviewPreparationTarget> = {},
): ReviewPreparationTarget {
  return {
    knowledgeDimension: 'contextual-meaning',
    schedule: {
      dueAt: '2026-08-16T08:00:00.000Z',
      demonstratedCount: 0,
      intervalStage: 0,
    },
    enabled: true,
    context,
    approval: null,
    ...overrides,
  };
}
function queue(
  storage = memoryStorage(),
  overrides: Partial<
    Parameters<typeof createReviewPreparationQueue>[1]
  > = {},
) {
  return createReviewPreparationQueue(storage, {
    now: () => '2026-08-15T12:00:00.000Z',
    id: () => 'job-1',
    isOnline: async () => true,
    isReusable: async () => true,
    excludeStaleApproval: async () => undefined,
    reservation: () => ({ tokens: 1_000, estimatedCostUsd: 0.01 }),
    budget: {
      async reserve() {
        throw new Error('No queued work should run in this test.');
      },
      async reconcile() {},
      async release() {},
    },
    worker: {
      async execute() {
        throw new Error('No queued work should run in this test.');
      },
    },
    activation: {
      async activate() {
        throw new Error('No queued work should activate in this test.');
      },
    },
    ...overrides,
  });
}

const approvedItem: ApprovedReviewItem = {
  version: 1,
  id: 'review-1',
  learningItemId: 'learning-1',
  knowledgeDimension: 'contextual-meaning',
  task: {
    type: 'recall',
    prompt: 'What does postpone mean here?',
    contextQuote: "Let's postpone the exam.",
    targetAnswers: ['delay until later'],
    acceptableAlternativeAnswers: [],
    partialAnswers: [],
    correctiveExplanation: 'Postpone means delay until later.',
  },
  provenance: {
    approvedAt: '2026-08-15T12:00:00.000Z',
    generation: context.generation,
    validatorVersion: 'review-validator-v1',
    evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
    relevantEvidence: [
      BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0]!,
    ],
    sourceAuthority: {
      knowledgeDimension: 'contextual-meaning',
      evidence: [
        {
          evidenceId:
            BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0]!.id,
          sourceId:
            BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0]!.sourceId,
          sourceVersion:
            BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0]!
              .sourceVersion,
          authority: 'primary-lexical',
        },
      ],
    },
    licenseAndAttribution:
      BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution,
    validation: { outcome: 'approved', reasons: [] },
  },
};

const usage: ProviderUsage = {
  inputTokens: 600,
  cachedInputTokens: 0,
  outputTokens: 300,
  reasoningTokens: 100,
  totalTokens: 900,
  estimatedCostUsd: 0.009,
};

describe('Review Preparation queue', () => {
  it('queues only enabled Knowledge Dimensions approaching due need', async () => {
    const preparation = queue();

    await preparation.sync([
      target(),
      target({
        knowledgeDimension: 'usage-fit',
        schedule: {
          dueAt: '2026-08-17T13:00:00.000Z',
          demonstratedCount: 0,
          intervalStage: 0,
        },
      }),
      target({
        knowledgeDimension: 'productive-use',
        enabled: false,
      }),
    ]);

    await expect(preparation.snapshot()).resolves.toMatchObject({
      jobs: [
        {
          id: 'job-1',
          knowledgeDimension: 'contextual-meaning',
          kind: 'generate',
          status: 'queued',
          attempts: 0,
        },
      ],
    });
  });

  it('removes queued work when its Knowledge Dimension is disabled', async () => {
    const preparation = queue();
    await preparation.sync([target()]);

    await preparation.sync([target({ enabled: false })]);

    await expect(preparation.snapshot()).resolves.toEqual({ jobs: [] });
  });

  it('refreshes durable schedule progress while work remains queued', async () => {
    const preparation = queue();
    await preparation.sync([target()]);

    await preparation.sync([
      target({
        schedule: {
          dueAt: '2026-08-16T08:00:00.000Z',
          demonstratedCount: 2,
          intervalStage: 3,
        },
      }),
    ]);

    await expect(preparation.snapshot()).resolves.toMatchObject({
      jobs: [
        {
          schedule: {
            demonstratedCount: 2,
            intervalStage: 3,
          },
        },
      ],
    });
  });

  it('reserves background capacity and activates only approved work', async () => {

    const reservations: unknown[] = [];
    const reconciliations: ProviderUsage[] = [];
    const activations: string[] = [];
    const preparation = queue(memoryStorage(), {
      budget: {
        async reserve(request) {
          reservations.push(request);
          return {
            status: 'reserved',
            reservation: {
              id: 'reservation-1',
              activeDate: '2026-08-15',
              tokens: request.tokens,
              estimatedCostUsd: request.estimatedCostUsd,
              scope: 'background',
            },
          };
        },
        async reconcile(_reservation, actualUsage) {
          reconciliations.push(actualUsage);
        },
        async release() {
          throw new Error('Successful work must reconcile its reservation.');
        },
      },
      worker: {
        async execute(job) {
          expect(job).toMatchObject({ status: 'running', attempts: 1 });
          return {
            item: approvedItem,
            schedule: {
              dueAt: '2026-08-16T08:00:00.000Z',
              demonstratedCount: 0,
              intervalStage: 0,
            },
            usage,
          };
        },
      },
      activation: {
        async activate({ result }) {
          activations.push(result.item.id);
        },
      },
    });
    await preparation.sync([target()]);

    await expect(preparation.runNext()).resolves.toMatchObject({
      status: 'completed',
      jobId: 'job-1',
    });

    expect(reservations).toEqual([
      {
        scope: 'background',
        tokens: 1_000,
        estimatedCostUsd: 0.01,
      },
    ]);
    expect(reconciliations).toEqual([usage]);
    expect(activations).toEqual(['review-1']);
    await expect(preparation.snapshot()).resolves.toEqual({ jobs: [] });
  });

  it('persists transient attempts, pauses at three, and resumes only explicitly', async () => {
    let shouldFail = true;
    let executions = 0;
    let releases = 0;
    const preparation = queue(memoryStorage(), {
      budget: {
        async reserve(request) {
          return {
            status: 'reserved',
            reservation: {
              id: `reservation-${executions + 1}`,
              activeDate: '2026-08-15',
              tokens: request.tokens,
              estimatedCostUsd: request.estimatedCostUsd,
              scope: 'background',
            },
          };
        },
        async reconcile() {},
        async release() {
          releases += 1;
        },
      },
      worker: {
        async execute() {
          executions += 1;
          if (shouldFail) {
            throw new ReviewPreparationFailure('server', true);
          }
          return {
            item: approvedItem,
            schedule: {
              dueAt: '2026-08-16T08:00:00.000Z',
              demonstratedCount: 0,
              intervalStage: 0,
            },
            usage,
          };
        },
      },
      activation: { async activate() {} },
    });
    await preparation.sync([target()]);

    await expect(preparation.runNext()).resolves.toMatchObject({
      status: 'retrying',
      reason: 'server',
    });
    await expect(preparation.runNext()).resolves.toMatchObject({
      status: 'retrying',
      reason: 'server',
    });
    await expect(preparation.runNext()).resolves.toMatchObject({
      status: 'paused',
      reason: 'retry-exhausted',
    });
    await expect(preparation.runNext()).resolves.toEqual({ status: 'idle' });
    await expect(preparation.snapshot()).resolves.toMatchObject({
      jobs: [
        {
          status: 'paused',
          attempts: 3,
          pauseReason: 'retry-exhausted',
          lastFailureKind: 'server',
        },
      ],
    });

    shouldFail = false;
    await preparation.resume('job-1');
    await expect(preparation.runNext()).resolves.toMatchObject({
      status: 'completed',
    });
    expect(executions).toBe(4);
    expect(releases).toBe(3);
  });

  it('recovers an interrupted persisted attempt after service-worker restart', async () => {
    const storage = memoryStorage();
    const firstWorker = queue(storage);
    await firstWorker.sync([target()]);
    const stored = await storage.get(
      REVIEW_PREPARATION_JOBS_STORAGE_KEY,
    );
    const interrupted = structuredClone(
      stored[REVIEW_PREPARATION_JOBS_STORAGE_KEY],
    ) as {
      version: 1;
      jobs: Array<Record<string, unknown>>;
    };
    Object.assign(interrupted.jobs[0]!, {
      status: 'running',
      attempts: 1,
    });
    await storage.set({
      [REVIEW_PREPARATION_JOBS_STORAGE_KEY]: interrupted,
    });

    let recoveredAttempt = 0;
    const restartedWorker = queue(storage, {
      budget: {
        async reserve(request) {
          return {
            status: 'reserved',
            reservation: {
              id: 'reservation-recovered',
              activeDate: '2026-08-15',
              tokens: request.tokens,
              estimatedCostUsd: request.estimatedCostUsd,
              scope: 'background',
            },
          };
        },
        async reconcile() {},
        async release() {},
      },
      worker: {
        async execute(job) {
          recoveredAttempt = job.attempts;
          return {
            item: approvedItem,
            schedule: {
              dueAt: '2026-08-16T08:00:00.000Z',
              demonstratedCount: 0,
              intervalStage: 0,
            },
            usage,
          };
        },
      },
      activation: { async activate() {} },
    });

    await expect(restartedWorker.runNext()).resolves.toMatchObject({
      status: 'completed',
    });
    expect(recoveredAttempt).toBe(2);
  });

  it('fans out stale pack approvals by Knowledge Dimension and excludes them immediately', async () => {
    const excluded: string[] = [];
    const staleUsageFit = {
      ...approvedItem,
      id: 'review-usage',
      knowledgeDimension: 'usage-fit' as const,
    };
    const freshGrammar = {
      ...approvedItem,
      id: 'review-grammar',
      knowledgeDimension: 'grammar-pattern' as const,
    };
    let nextId = 0;
    const preparation = queue(memoryStorage(), {
      id: () => `job-${++nextId}`,
      isReusable: async (item) => item.id === freshGrammar.id,
      excludeStaleApproval: async (item) => {
        excluded.push(item.id);
      },
    });

    await preparation.sync([
      target({ approval: approvedItem }),
      target({
        knowledgeDimension: 'usage-fit',
        approval: staleUsageFit,
      }),
      target({
        knowledgeDimension: 'grammar-pattern',
        approval: freshGrammar,
      }),
    ]);

    expect(excluded).toEqual(['review-1', 'review-usage']);
    await expect(preparation.snapshot()).resolves.toMatchObject({
      jobs: [
        {
          id: 'job-1',
          kind: 'revalidate',
          replacedReviewItemId: 'review-1',
          knowledgeDimension: 'contextual-meaning',
        },
        {
          id: 'job-2',
          kind: 'revalidate',
          replacedReviewItemId: 'review-usage',
          knowledgeDimension: 'usage-fit',
        },
      ],
    });
  });

  it('pauses offline or budget-blocked work without consuming an attempt', async () => {
    let online = false;
    let workerCalls = 0;
    const preparation = queue(memoryStorage(), {
      isOnline: async () => online,
      budget: {
        async reserve() {
          return {
            status: 'blocked',
            kind: 'token-budget',
            scope: 'background',
          };
        },
        async reconcile() {},
        async release() {},
      },
      worker: {
        async execute() {
          workerCalls += 1;
          throw new Error('Budget-blocked work must not execute.');
        },
      },
    });
    await preparation.sync([target()]);

    await expect(preparation.runNext()).resolves.toMatchObject({
      status: 'paused',
      reason: 'offline',
    });
    await expect(preparation.snapshot()).resolves.toMatchObject({
      jobs: [{ attempts: 0, pauseReason: 'offline' }],
    });

    online = true;
    await preparation.sync([target()]);
    await expect(preparation.snapshot()).resolves.toMatchObject({
      jobs: [{ status: 'queued', attempts: 0, pauseReason: null }],
    });
    await expect(preparation.runNext()).resolves.toMatchObject({
      status: 'paused',
      reason: 'background-token-budget',
    });
    await expect(preparation.snapshot()).resolves.toMatchObject({
      jobs: [
        {
          attempts: 0,
          pauseReason: 'background-token-budget',
          lastFailureKind: 'token-budget',
        },
      ],
    });
    await preparation.sync([target()]);
    await expect(preparation.snapshot()).resolves.toMatchObject({
      jobs: [{ status: 'queued', attempts: 0, pauseReason: null }],
    });
    expect(workerCalls).toBe(0);
  });
});
