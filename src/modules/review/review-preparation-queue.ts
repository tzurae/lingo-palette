import { z } from 'zod';
import type {
  BudgetReservation,
  ProviderUsage,
} from '../openai/budget-ledger';
import {
  reviewGenerationContextSchema,
  type ApprovedReviewItem,
  type ReviewGenerationContext,
} from './review-generation-harness';
import {
  measuredReviewKnowledgeDimensionSchema,
  type MeasuredReviewKnowledgeDimension,
} from './review-source-authority';

export const REVIEW_PREPARATION_JOBS_STORAGE_KEY =
  'reviewPreparationJobsV1';
const preparationDimensionRank = new Map<
  MeasuredReviewKnowledgeDimension,
  number
>([
  ['contextual-meaning', 0],
  ['usage-fit', 1],
  ['grammar-pattern', 2],
  ['collocation', 3],
  ['productive-use', 4],
]);

const preparationScheduleSchema = z
  .object({
    dueAt: z.iso.datetime(),
    demonstratedCount: z.number().int().nonnegative(),
    intervalStage: z.number().int().nonnegative(),
  })
  .strict();

const jobSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    learningItemId: z.string().min(1),
    knowledgeDimension: measuredReviewKnowledgeDimensionSchema,
    kind: z.enum(['generate', 'revalidate']),
    replacedReviewItemId: z.string().min(1).nullable(),
    schedule: preparationScheduleSchema,
    context: reviewGenerationContextSchema,
    status: z.enum(['queued', 'running', 'paused']),
    attempts: z.number().int().min(0).max(3),
    pauseReason: z
      .enum([
        'offline',
        'provider-disabled',
        'background-token-budget',
        'background-estimated-cost-budget',
        'retry-exhausted',
        'non-retryable',
        'activation-failed',
      ])
      .nullable(),
    lastFailureKind: z.string().min(1).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const stateSchema = z
  .object({ version: z.literal(1), jobs: z.array(jobSchema) })
  .strict();

export type ReviewPreparationJob = Readonly<z.infer<typeof jobSchema>>;
export type ReviewPreparationTarget = Readonly<{
  knowledgeDimension: MeasuredReviewKnowledgeDimension;
  schedule: ReviewPreparationSchedule;
  enabled: boolean;
  context: ReviewGenerationContext;
  approval: ApprovedReviewItem | null;
}>;

export type ReviewPreparationSchedule = Readonly<
  z.infer<typeof preparationScheduleSchema>
>;

export type ReviewPreparationStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type ReviewPreparationBudget = {
  reserve(request: {
    scope: 'background';
    tokens: number;
    estimatedCostUsd: number | null;
  }): Promise<
    | { status: 'reserved'; reservation: BudgetReservation }
    | {
        status: 'blocked';
        kind: 'provider-disabled' | 'token-budget' | 'estimated-cost-budget';
        scope?: 'background';
      }
  >;
  reconcile(
    reservation: BudgetReservation,
    usage: ProviderUsage,
  ): Promise<void>;
  release(reservation: BudgetReservation): Promise<void>;
};

export type ReviewPreparationResult = Readonly<{
  item: ApprovedReviewItem;
  schedule: ReviewPreparationSchedule;
  usage: ProviderUsage;
}>;

export type ReviewPreparationWorker = {
  execute(job: ReviewPreparationJob): Promise<ReviewPreparationResult>;
};

export type ReviewPreparationActivation = {
  activate(input: {
    job: ReviewPreparationJob;
    result: ReviewPreparationResult;
  }): Promise<void>;
};

export type ReviewPreparationSnapshot = Readonly<{
  jobs: readonly ReviewPreparationJob[];
}>;

export class ReviewPreparationFailure extends Error {
  readonly kind: string;
  readonly retryable: boolean;
  readonly usage: ProviderUsage | null;

  constructor(
    kind: string,
    retryable: boolean,
    options: { message?: string; usage?: ProviderUsage | null } = {},
  ) {
    super(options.message ?? `Review preparation failed: ${kind}`);
    this.name = 'ReviewPreparationFailure';
    this.kind = kind;
    this.retryable = retryable;
    this.usage = options.usage ?? null;
  }
}

export type ReviewPreparationRunResult =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'completed'; jobId: string }>
  | Readonly<{
      status: 'paused' | 'retrying';
      jobId: string;
      reason: string;
    }>;

const emptyState = () => ({ version: 1 as const, jobs: [] });

function preparationIdentity(
  learningItemId: string,
  knowledgeDimension: MeasuredReviewKnowledgeDimension,
  replacedReviewItemId: string | null,
  generation: ReviewGenerationContext['generation'],
): string {
  return JSON.stringify([
    learningItemId,
    knowledgeDimension,
    replacedReviewItemId,
    generation.model,
    generation.promptVersion,
  ]);
}

export function createReviewPreparationQueue(
  storage: ReviewPreparationStorage,
  dependencies: {
    now?: () => string;
    id?: () => string;
    lookaheadMs?: number;
    isOnline(): boolean | Promise<boolean>;
    isReusable(
      item: ApprovedReviewItem,
      generation: ReviewGenerationContext['generation'],
    ): Promise<boolean>;
    excludeStaleApproval(item: ApprovedReviewItem): Promise<void>;
    reservation(
      job: ReviewPreparationJob,
    ):
      | { tokens: number; estimatedCostUsd: number | null }
      | Promise<{ tokens: number; estimatedCostUsd: number | null }>;
    budget: ReviewPreparationBudget;
    worker: ReviewPreparationWorker;
    activation: ReviewPreparationActivation;
  },
): {
  sync(targets: readonly ReviewPreparationTarget[]): Promise<void>;
  runNext(): Promise<ReviewPreparationRunResult>;
  resume(jobId: string): Promise<void>;
  snapshot(): Promise<ReviewPreparationSnapshot>;
} {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const id = dependencies.id ?? (() => crypto.randomUUID());
  const lookaheadMs = dependencies.lookaheadMs ?? 24 * 60 * 60 * 1_000;
  let pending = Promise.resolve();

  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = pending;
    const completion = Promise.withResolvers<void>();
    pending = completion.promise;
    await previous;
    try {
      return await operation();
    } finally {
      completion.resolve();
    }
  };

  const load = async () => {
    const stored = await storage.get(REVIEW_PREPARATION_JOBS_STORAGE_KEY);
    const raw = stored[REVIEW_PREPARATION_JOBS_STORAGE_KEY];
    if (raw === undefined) return emptyState();
    const parsed = stateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        'Stored Review Preparation queue is invalid; existing data was not changed.',
      );
    }
    return parsed.data;
  };

  const save = (state: z.infer<typeof stateSchema>) =>
    storage.set({ [REVIEW_PREPARATION_JOBS_STORAGE_KEY]: state });

  return {
    sync(targets) {
      return serialized(async () => {
        const state = await load();
        const asOf = Date.parse(now());
        const horizon = asOf + lookaheadMs;
        let jobs = state.jobs.map((job) =>
          job.status === 'paused' &&
          (job.pauseReason === 'offline' ||
            job.pauseReason === 'provider-disabled' ||
            job.pauseReason === 'background-token-budget' ||
            job.pauseReason === 'background-estimated-cost-budget')
            ? jobSchema.parse({
                ...job,
                status: 'queued',
                pauseReason: null,
                updatedAt: now(),
              })
            : job,
        );
        const desiredJobs = new Set<string>();
        for (const target of targets) {
          const context = reviewGenerationContextSchema.parse(target.context);
          if (
            !target.enabled ||
            !Number.isFinite(Date.parse(target.schedule.dueAt)) ||
            Date.parse(target.schedule.dueAt) > horizon
          ) {
            continue;
          }
          const reusable =
            target.approval !== null &&
            (await dependencies.isReusable(
              target.approval,
              context.generation,
            ));
          if (reusable) continue;
          if (target.approval !== null) {
            await dependencies.excludeStaleApproval(target.approval);
          }
          const replacedReviewItemId = target.approval?.id ?? null;
          const identity = preparationIdentity(
            context.learningItem.id,
            target.knowledgeDimension,
            replacedReviewItemId,
            context.generation,
          );
          desiredJobs.add(identity);
          const existingIndex = jobs.findIndex(
            (job) =>
              preparationIdentity(
                job.learningItemId,
                job.knowledgeDimension,
                job.replacedReviewItemId,
                job.context.generation,
              ) === identity,
          );
          if (existingIndex >= 0) {
            const existingJob = jobs[existingIndex]!;
            if (
              JSON.stringify(existingJob.schedule) !==
                JSON.stringify(target.schedule) ||
              JSON.stringify(existingJob.context) !==
                JSON.stringify(context)
            ) {
              jobs = jobs.with(
                existingIndex,
                jobSchema.parse({
                  ...existingJob,
                  schedule: target.schedule,
                  context,
                  updatedAt: now(),
                }),
              );
            }
            continue;
          }
          const timestamp = now();
          jobs = [
            ...jobs,
            jobSchema.parse({
              version: 1,
              id: id(),
              learningItemId: context.learningItem.id,
              knowledgeDimension: target.knowledgeDimension,
              kind: target.approval === null ? 'generate' : 'revalidate',
              replacedReviewItemId,
              schedule: target.schedule,
              context,
              status: 'queued',
              attempts: 0,
              pauseReason: null,
              lastFailureKind: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          ];
        }
        const retainedJobs = jobs.filter((job) =>
          desiredJobs.has(
            preparationIdentity(
              job.learningItemId,
              job.knowledgeDimension,
              job.replacedReviewItemId,
              job.context.generation,
            ),
          ),
        );
        if (retainedJobs.length !== jobs.length) jobs = retainedJobs;
        if (jobs !== state.jobs) await save({ version: 1, jobs });
      });
    },

    runNext() {
      return serialized(async () => {
        let state = await load();
        const recoveredAt = now();
        const recoveredJobs = state.jobs.map((job) => {
          if (job.status !== 'running') return job;
          if (job.attempts >= 3) {
            return jobSchema.parse({
              ...job,
              status: 'paused',
              pauseReason: 'retry-exhausted',
              lastFailureKind: 'interrupted',
              updatedAt: recoveredAt,
            });
          }
          return jobSchema.parse({
            ...job,
            status: 'queued',
            pauseReason: null,
            lastFailureKind: 'interrupted',
            updatedAt: recoveredAt,
          });
        });
        if (
          recoveredJobs.some((job, index) => job !== state.jobs[index])
        ) {
          state = { version: 1, jobs: recoveredJobs };
          await save(state);
        }

        const queued = state.jobs
          .filter((job) => job.status === 'queued')
          .sort(
            (left, right) =>
              left.schedule.dueAt.localeCompare(right.schedule.dueAt) ||
              left.learningItemId.localeCompare(
                right.learningItemId,
              ) ||
              (preparationDimensionRank.get(
                left.knowledgeDimension,
              ) ?? 5) -
                (preparationDimensionRank.get(
                  right.knowledgeDimension,
                ) ?? 5) ||
              left.createdAt.localeCompare(right.createdAt) ||
              left.id.localeCompare(right.id),
          )[0];
        if (queued === undefined) return { status: 'idle' } as const;

        const replaceJob = async (replacement: ReviewPreparationJob) => {
          state = {
            version: 1,
            jobs: state.jobs.map((job) =>
              job.id === replacement.id ? replacement : job,
            ),
          };
          await save(state);
        };
        const pause = async (
          job: ReviewPreparationJob,
          reason: ReviewPreparationJob['pauseReason'],
          failureKind: string | null,
        ) => {
          const paused = jobSchema.parse({
            ...job,
            status: 'paused',
            pauseReason: reason,
            lastFailureKind: failureKind,
            updatedAt: now(),
          });
          await replaceJob(paused);
          return {
            status: 'paused',
            jobId: paused.id,
            reason: reason ?? 'unknown',
          } as const;
        };

        if (!(await dependencies.isOnline())) {
          return pause(queued, 'offline', 'offline');
        }

        const estimate = await dependencies.reservation(queued);
        const reservation = await dependencies.budget.reserve({
          scope: 'background',
          ...estimate,
        });
        if (reservation.status === 'blocked') {
          const reason =
            reservation.kind === 'provider-disabled'
              ? 'provider-disabled'
              : reservation.kind === 'token-budget'
                ? 'background-token-budget'
                : 'background-estimated-cost-budget';
          return pause(queued, reason, reservation.kind);
        }

        const running = jobSchema.parse({
          ...queued,
          status: 'running',
          attempts: queued.attempts + 1,
          pauseReason: null,
          lastFailureKind: null,
          updatedAt: now(),
        });
        await replaceJob(running);

        let result: ReviewPreparationResult;
        try {
          result = await dependencies.worker.execute(running);
        } catch (error) {
          const failure =
            error instanceof ReviewPreparationFailure
              ? error
              : new ReviewPreparationFailure('unknown', false, {
                  message:
                    error instanceof Error ? error.message : String(error),
                });
          if (failure.usage === null) {
            await dependencies.budget.release(reservation.reservation);
          } else {
            await dependencies.budget.reconcile(
              reservation.reservation,
              failure.usage,
            );
          }
          if (failure.retryable && running.attempts < 3) {
            const retrying = jobSchema.parse({
              ...running,
              status: 'queued',
              lastFailureKind: failure.kind,
              updatedAt: now(),
            });
            await replaceJob(retrying);
            return {
              status: 'retrying',
              jobId: retrying.id,
              reason: failure.kind,
            } as const;
          }
          return pause(
            running,
            failure.retryable ? 'retry-exhausted' : 'non-retryable',
            failure.kind,
          );
        }

        await dependencies.budget.reconcile(
          reservation.reservation,
          result.usage,
        );
        try {
          await dependencies.activation.activate({ job: running, result });
        } catch (error) {
          return pause(
            running,
            'activation-failed',
            error instanceof Error ? error.name : 'activation-failed',
          );
        }
        await save({
          version: 1,
          jobs: state.jobs.filter((job) => job.id !== running.id),
        });
        return { status: 'completed', jobId: running.id } as const;
      });
    },

    resume(jobId) {
      return serialized(async () => {
        const state = await load();
        const job = state.jobs.find((candidate) => candidate.id === jobId);
        if (job === undefined) {
          throw new Error(`Review Preparation job ${jobId} was not found.`);
        }
        if (job.status !== 'paused') {
          throw new Error(`Review Preparation job ${jobId} is not paused.`);
        }
        const resumed = jobSchema.parse({
          ...job,
          status: 'queued',
          attempts: 0,
          pauseReason: null,
          lastFailureKind: null,
          updatedAt: now(),
        });
        await save({
          version: 1,
          jobs: state.jobs.map((candidate) =>
            candidate.id === jobId ? resumed : candidate,
          ),
        });
      });
    },

    snapshot() {
      return serialized(async () => {
        const state = await load();
        return { jobs: state.jobs };
      });
    },
  };
}
