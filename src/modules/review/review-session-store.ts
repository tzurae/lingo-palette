import { z } from 'zod';
import {
  calibrationFor,
  retrievalFluencySchema,
  reviewEvidenceSchema,
  normalizeReviewAnswer,
  reviewJudgmentSchema,
  transitionReviewSchedule,
  type ReviewEvidence,
  type ReviewJudgment,
  type RetrievalFluency,
} from './review-evidence';
import type {
  ApprovedReviewItem,
  MeasuredReviewKnowledgeDimension,
} from './review-generation-harness';
import { reviewSourceAuthoritySchema } from './review-source-authority';
import {
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_EVIDENCE_STORAGE_KEY,
  REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
  REVIEW_SCHEDULES_STORAGE_KEY,
  REVIEW_SESSIONS_STORAGE_KEY,
} from './review-storage-keys';


const knowledgeDimensionSchema = z.enum([
  'contextual-meaning',
  'usage-fit',
  'grammar-pattern',
  'collocation',
  'productive-use',
]);
const scheduleKnowledgeDimensionSchema = z.enum([
  'contextual-meaning',
  'usage-fit',
  'grammar-pattern',
  'collocation',
  'productive-use',
]);
const taskSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('contrastive'),
      prompt: z.string().min(1),
      contextQuote: z.string().min(1),
      targetAnswers: z.array(z.string().min(1)).min(1),
      acceptableAlternativeAnswers: z.array(z.string().min(1)),
      partialAnswers: z.array(z.string().min(1)),
      distractors: z.array(z.string().min(1)).min(1),
      correctiveExplanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.enum(['recall', 'productive']),
      prompt: z.string().min(1),
      contextQuote: z.string().min(1),
      targetAnswers: z.array(z.string().min(1)).min(1),
      acceptableAlternativeAnswers: z.array(z.string().min(1)),
      partialAnswers: z.array(z.string().min(1)),
      correctiveExplanation: z.string().min(1),
    })
    .strict(),
]);
const legacyTaskSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('contrastive'),
      prompt: z.string().min(1),
      contextQuote: z.string().min(1),
      acceptedAnswers: z.array(z.string().min(1)).min(1),
      distractors: z.array(z.string().min(1)).min(1),
      correctiveExplanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('recall'),
      prompt: z.string().min(1),
      contextQuote: z.string().min(1),
      acceptedAnswers: z.array(z.string().min(1)).min(1),
      correctiveExplanation: z.string().min(1),
    })
    .strict(),
]);
const compatibleTaskSchema = z
  .union([taskSchema, legacyTaskSchema])
  .transform((task) => {
    if (!('acceptedAnswers' in task)) return task;
    const { acceptedAnswers, ...legacyTask } = task;
    return {
      ...legacyTask,
      targetAnswers: [],
      acceptableAlternativeAnswers: acceptedAnswers,
      partialAnswers: [],
    };
  });
const evidenceHashSchema = z.string().min(1);
const reviewProvenanceEvidenceSchema = z.discriminatedUnion('authority', [
  z
    .object({
      id: z.string().min(1),
      sourceId: z.string().min(1),
      sourceVersion: z.string().min(1),
      sourceSenseId: z.string().min(1),
      partOfSpeech: z.string().min(1),
      definition: z.string().min(1),
      members: z.array(z.string()),
      examples: z.array(z.string()),
      authority: z.enum(['primary-lexical', 'supplemental']),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      sourceId: z.string().min(1),
      sourceVersion: z.string().min(1),
      sourceSenseId: z.string().min(1),
      partOfSpeech: z.string().min(1),
      morphology: z.string().min(1),
      contextQuote: z.string().min(1),
      fit: z.enum(['fits', 'does-not-fit']),
      attestation: z.string().min(1),
      authority: z.enum(['sense-context', 'lexical-relation', 'frequency']),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      sourceId: z.string().min(1),
      sourceVersion: z.string().min(1),
      sourceSenseId: z.string().min(1),
      partOfSpeech: z.string().min(1),
      morphologies: z.array(z.string().min(1)),
      pattern: z.string().min(1),
      attestation: z.string().min(1),
      authority: z.enum([
        'source-recorded-frame',
        'source-recorded-usage-note',
        'pos-aware-corpus-attestation',
      ]),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      sourceId: z.string().min(1),
      sourceVersion: z.string().min(1),
      authority: z.literal('corpus-collocation'),
      targetExpression: z.string().min(1),
      collocate: z.string().min(1),
      partOfSpeech: z.string().min(1),
      targetMorphologies: z.array(z.string().min(1)),
      window: z.object({ type: z.literal('same-sentence') }).strict(),
      rawCount: z.number().int().nonnegative(),
      association: z
        .object({
          metric: z.literal('log-likelihood'),
          value: z.number().nonnegative(),
        })
        .strict(),
      minimumRawCount: z.number().int().positive(),
      corpus: z
        .object({
          name: z.string().min(1),
          language: z.literal('en'),
          sentenceCount: z.number().int().positive(),
          tokenCount: z.number().int().positive(),
          sourceUrl: z.url(),
        })
        .strict(),
    })
    .strict(),
]);
const evidencePackManifestSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal(1),
    version: z.string().min(1),
    language: z.literal('en'),
    minimumExtensionVersion: z.string().min(1),
    compression: z.literal('gzip'),
    compressedSizeBytes: z.number().int().positive(),
    installedSizeBytes: z.number().int().positive(),
    contentIdentitySha256: evidenceHashSchema,
    contentHashes: z.array(
      z
        .object({
          path: z.string().min(1),
          byteSize: z.number().int().nonnegative(),
          sha256: evidenceHashSchema,
        })
        .strict(),
    ),
    licenses: z.array(
      z
        .object({
          id: z.string().min(1),
          path: z.string().min(1),
          byteSize: z.number().int().nonnegative(),
          sha256: evidenceHashSchema,
        })
        .strict(),
    ),
    sources: z.array(
      z
        .object({
          id: z.string().min(1),
          version: z.string().min(1),
          asset: z.string().min(1),
          sha256: evidenceHashSchema,
          licenseIds: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();
const licenseAndAttributionSchema = z
  .object({
    sourceId: z.string().min(1),
    sourceName: z.string().min(1),
    sourceVersion: z.string().min(1),
    attribution: z.string().min(1),
    licenseIdentifiers: z.array(z.string().min(1)),
    licenseTextHashes: z.array(
      z
        .object({
          licenseIdentifier: z.string().min(1),
          sha256: evidenceHashSchema,
        })
        .strict(),
    ),
    notice: z.string().min(1),
    licenseUrls: z.array(z.url()),
    sourceUrl: z.url(),
  })
  .strict();
const approvedReviewItemSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    learningItemId: z.string().min(1),
    knowledgeDimension: knowledgeDimensionSchema,
    task: compatibleTaskSchema,
    provenance: z
      .object({
        approvedAt: z.iso.datetime(),
        generation: z
          .object({
            model: z.string().min(1),
            promptVersion: z.string().min(1),
          })
          .strict(),
        validatorVersion: z.string().min(1),
        evidencePack: evidencePackManifestSchema,
        relevantEvidence: z.array(reviewProvenanceEvidenceSchema),
        sourceAuthority: reviewSourceAuthoritySchema.optional(),
        licenseAndAttribution: z.array(licenseAndAttributionSchema),
        validation: z
          .object({
            outcome: z.enum(['approved', 'safe-fallback']),
            reasons: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((item, context) => {
    const hasProductiveTask = item.task.type === 'productive';
    if (
      (item.knowledgeDimension === 'productive-use') !== hasProductiveTask
    ) {
      context.addIssue({
        code: 'custom',
        path: ['task', 'type'],
        message:
          'Productive Review task must match the productive-use Knowledge Dimension.',
      });
    }
    const sourceAuthority = item.provenance.sourceAuthority;
    if (
      sourceAuthority !== undefined &&
      sourceAuthority.knowledgeDimension !== item.knowledgeDimension
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'sourceAuthority'],
        message:
          'Review Item source authority must match its Knowledge Dimension.',
      });
    }
    if (
      item.knowledgeDimension !== 'contextual-meaning' &&
      sourceAuthority === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'sourceAuthority'],
        message:
          'Usage-fit and grammar-pattern Review Items require matching source authority.',
      });
    }
    if (item.provenance.sourceAuthority === undefined) return;
    const relevantEvidence = item.provenance.relevantEvidence ?? [];
    const authorityEvidence = item.provenance.sourceAuthority.evidence;
    for (const [index, authority] of authorityEvidence.entries()) {
      if (
        relevantEvidence.some(
          (entry) =>
            entry.id === authority.evidenceId &&
            entry.sourceId === authority.sourceId &&
            entry.sourceVersion === authority.sourceVersion &&
            entry.authority === authority.authority,
        )
      ) {
        continue;
      }
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'sourceAuthority', 'evidence', index],
        message:
          'Source authority must pin matching relevant Evidence Pack provenance.',
      });
    }
  });
const approvedStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(approvedReviewItemSchema),
  })
  .strict();
const scheduleSchema = z
  .object({
    version: z.literal(1),
    learningItemId: z.string().min(1),
    knowledgeDimension: scheduleKnowledgeDimensionSchema,
    dueAt: z.iso.datetime(),
    demonstratedCount: z.number().int().nonnegative(),
    intervalStage: z.number().int().min(0).max(8),
  })
  .strict();
const scheduleStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(scheduleSchema),
  })
  .strict();
const scheduleTransitionSchema = z
  .object({
    previous: z
      .object({
        dueAt: z.iso.datetime(),
        demonstratedCount: z.number().int().nonnegative(),
        intervalStage: z.number().int().min(0).max(8),
      })
      .strict(),
    next: z
      .object({
        dueAt: z.iso.datetime(),
        demonstratedCount: z.number().int().nonnegative(),
        intervalStage: z.number().int().min(0).max(8),
      })
      .strict(),
  })
  .strict();
const recordedEvidenceSchema = z.intersection(
  reviewEvidenceSchema,
  z.object({ scheduleTransition: scheduleTransitionSchema }),
);
const evidenceStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(recordedEvidenceSchema),
  })
  .strict()
  .superRefine((state, context) => {
    const ids = new Set<string>();
    for (const [index, record] of state.records.entries()) {
      if (ids.has(record.id)) {
        context.addIssue({
          code: 'custom',
          path: ['records', index, 'id'],
          message: `Duplicate Review Evidence ID ${record.id}.`,
        });
      }
      ids.add(record.id);
    }
  });
const sessionSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    status: z.enum(['active', 'completed']),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    reviewItemIds: z.array(z.string().min(1)).min(1).max(5),
    currentIndex: z.number().int().nonnegative(),
    revealedReviewItemIds: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((session, context) => {
    const reviewItemIds = new Set<string>();
    for (const [index, reviewItemId] of session.reviewItemIds.entries()) {
      if (reviewItemIds.has(reviewItemId)) {
        context.addIssue({
          code: 'custom',
          path: ['reviewItemIds', index],
          message: `Duplicate Review Item ID ${reviewItemId}.`,
        });
      }
      reviewItemIds.add(reviewItemId);
    }
    const revealedIds = new Set<string>();
    for (const [index, reviewItemId] of session.revealedReviewItemIds.entries()) {
      if (
        revealedIds.has(reviewItemId) ||
        !reviewItemIds.has(reviewItemId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['revealedReviewItemIds', index],
          message:
            'Revealed Review Item IDs must be unique members of the session.',
        });
      }
      revealedIds.add(reviewItemId);
    }
    if (session.currentIndex >= session.reviewItemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['currentIndex'],
        message: 'Review Session currentIndex must identify a session item.',
      });
    }
    if (
      (session.status === 'active' && session.completedAt !== null) ||
      (session.status === 'completed' && session.completedAt === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Review Session status and completedAt must agree.',
      });
    }
  });
const sessionStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(sessionSchema),
  })
  .strict();
const revalidationMarkersSchema = z
  .object({
    version: z.literal(1),
    records: z.record(
      z.string(),
      z
        .object({
          reviewItemId: z.string().min(1),
          status: z.literal('pending'),
        })
        .passthrough(),
    ),
  })
  .strict();
const learningItemSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.iso.datetime(),
    status: z.enum(['active', 'merged']),
    productiveUseIntent: z.boolean().optional(),
  })
  .passthrough();
const answerInputSchema = z
  .object({
    retrievalFluency: retrievalFluencySchema,
    responseText: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export type ReviewSchedule = z.infer<typeof scheduleSchema>;
export type ReviewSessionRecord = z.infer<typeof sessionSchema>;
export type RecordedReviewEvidence = z.infer<typeof recordedEvidenceSchema>;

const portableReviewStateSchema = z
  .object({
    approvedItems: approvedStateSchema,
    evidence: evidenceStateSchema,
    schedules: scheduleStateSchema,
    sessions: sessionStateSchema,
  })
  .strict();

export function parsePortableReviewState(value: unknown) {
  return portableReviewStateSchema.parse(value);
}
export type ReviewSessionStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
export type ReviewResponseEvaluator = {
  evaluate(input: {
    item: ApprovedReviewItem;
    responseText: string;
  }): Promise<unknown>;
};
type ReviewCurrentBase = Readonly<{
  reviewItemId: string;
  learningItemId: string;
  knowledgeDimension: MeasuredReviewKnowledgeDimension;
  taskType: ApprovedReviewItem['task']['type'];
  prompt: string;
  contextQuote: string;
  attemptKind: ReviewEvidence['kind'];
}>;
export type ReviewSessionCurrent =
  | (ReviewCurrentBase & Readonly<{ revealed: false }>)
  | (ReviewCurrentBase &
      Readonly<{
        revealed: true;
        targetAnswers: readonly string[];
        acceptableAlternativeAnswers: readonly string[];
        partialAnswers: readonly string[];
        distractors: readonly string[];
        correctiveExplanation: string;
        evidence: ReviewEvidence;
      }>);
export type ReviewSessionView = Readonly<{
  id: string;
  status: 'active' | 'completed';
  total: number;
  shortened: boolean;
  reviewItemIds: readonly string[];
  position: number;
  current: ReviewSessionCurrent | null;
}>;

const emptyApprovedState = () => ({ version: 1 as const, records: [] });
const emptyScheduleState = () => ({ version: 1 as const, records: [] });
const emptySessionState = () => ({ version: 1 as const, records: [] });
const emptyEvidenceState = () => ({ version: 1 as const, records: [] });

export function createReviewSessionStore(
  storage: ReviewSessionStorage,
  dependencies: {
    id?: () => string;
    now?: () => string;
    evaluator?: ReviewResponseEvaluator;
  } = {},
): {
  approve(
    item: ApprovedReviewItem,
    schedule: {
      dueAt: string;
      demonstratedCount: number;
      intervalStage: number;
    },
  ): Promise<void>;
  activatePrepared(input: {
    item: ApprovedReviewItem;
    replacedReviewItemId: string | null;
    schedule: {
      dueAt: string;
      demonstratedCount: number;
      intervalStage: number;
    };
  }): Promise<void>;
  preparationSnapshot(): Promise<{
    approvedItems: readonly ApprovedReviewItem[];
    schedules: readonly ReviewSchedule[];
    pendingReviewItemIds: readonly string[];
  }>;
  setProductiveUseIntent(
    learningItemId: string,
    enabled: boolean,
    atomicStorageItems?: Record<string, unknown>,
  ): Promise<void>;
  start(
    learningItems: readonly unknown[],
  ): Promise<
    | { status: 'unavailable'; eligibleCount: 0 }
    | { status: 'started' | 'active'; session: ReviewSessionView }
  >;
  answer(
    sessionId: string,
    input: {
      retrievalFluency: RetrievalFluency;
      responseText?: string;
    },
  ): Promise<{
    status: 'revealed';
    session: ReviewSessionView;
  }>;
  advance(sessionId: string): Promise<{
    status: 'active' | 'completed';
    session: ReviewSessionView;
  }>;
  snapshot(learningItems: readonly unknown[]): Promise<{
    eligibleCount: number;
    activeSession: ReviewSessionView | null;
    schedules: readonly ReviewSchedule[];
    evidence: readonly RecordedReviewEvidence[];
  }>;
} {
  const id = dependencies.id ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date().toISOString());
  const evaluator = dependencies.evaluator ?? deterministicReviewEvaluator;
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

  return {
    approve(item, schedule) {
      return serialized(async () => {
        const approvedItem = approvedReviewItemSchema.parse(
          item,
        ) as ApprovedReviewItem;
        const approvedState = (await loadState(
          storage,
          APPROVED_REVIEW_ITEMS_STORAGE_KEY,
          approvedStateSchema,
          emptyApprovedState,
        )) as { version: 1; records: ApprovedReviewItem[] };
        const scheduleState = await loadState(
          storage,
          REVIEW_SCHEDULES_STORAGE_KEY,
          scheduleStateSchema,
          emptyScheduleState,
        );
        const existing = approvedState.records.find(
          (record) => record.id === approvedItem.id,
        );
        if (
          existing !== undefined &&
          JSON.stringify(existing) !== JSON.stringify(approvedItem)
        ) {
          throw new Error(`Review Item ${approvedItem.id} already has different data.`);
        }
        const nextSchedule = scheduleSchema.parse({
          version: 1,
          learningItemId: approvedItem.learningItemId,
          knowledgeDimension: approvedItem.knowledgeDimension,
          ...schedule,
        });
        const hasSchedule = scheduleState.records.some(
          (record) => scheduleIdentity(record) === scheduleIdentity(nextSchedule),
        );
        await storage.set({
          [APPROVED_REVIEW_ITEMS_STORAGE_KEY]: {
            version: 1,
            records:
              existing === undefined
                ? [...approvedState.records, approvedItem]
                : approvedState.records,
          },
          [REVIEW_SCHEDULES_STORAGE_KEY]: {
            version: 1,
            records: hasSchedule
              ? scheduleState.records
              : [...scheduleState.records, nextSchedule],
          },
        });
      });
    },

    activatePrepared({ item, replacedReviewItemId, schedule }) {
      return serialized(async () => {
        const approvedItem = approvedReviewItemSchema.parse(
          item,
        ) as ApprovedReviewItem;
        const [approvedState, scheduleState] = await Promise.all([
          loadState(
            storage,
            APPROVED_REVIEW_ITEMS_STORAGE_KEY,
            approvedStateSchema,
            emptyApprovedState,
          ) as Promise<{ version: 1; records: ApprovedReviewItem[] }>,
          loadState(
            storage,
            REVIEW_SCHEDULES_STORAGE_KEY,
            scheduleStateSchema,
            emptyScheduleState,
          ),
        ]);
        const replaced =
          replacedReviewItemId === null
            ? null
            : approvedState.records.find(
                (record) => record.id === replacedReviewItemId,
              );
        if (
          replacedReviewItemId !== null &&
          (replaced == null ||
            replaced.learningItemId !== approvedItem.learningItemId ||
            replaced.knowledgeDimension !==
              approvedItem.knowledgeDimension)
        ) {
          throw new Error(
            'Prepared Review replacement must match the existing Learning Item and Knowledge Dimension.',
          );
        }
        const existing = approvedState.records.find(
          (record) => record.id === approvedItem.id,
        );
        if (
          existing !== undefined &&
          (existing.learningItemId !== approvedItem.learningItemId ||
            existing.knowledgeDimension !==
              approvedItem.knowledgeDimension)
        ) {
          throw new Error(
            `Prepared Review Item ${approvedItem.id} changed identity.`,
          );
        }
        const nextSchedule = scheduleSchema.parse({
          version: 1,
          learningItemId: approvedItem.learningItemId,
          knowledgeDimension: approvedItem.knowledgeDimension,
          ...schedule,
        });
        await storage.set({
          [APPROVED_REVIEW_ITEMS_STORAGE_KEY]: {
            version: 1,
            records:
              existing === undefined
                ? [...approvedState.records, approvedItem]
                : approvedState.records,
          },
          [REVIEW_SCHEDULES_STORAGE_KEY]: {
            version: 1,
            records: [
              ...scheduleState.records.filter(
                (record) =>
                  scheduleIdentity(record) !==
                  scheduleIdentity(nextSchedule),
              ),
              nextSchedule,
            ],
          },
        });
      });
    },

    preparationSnapshot() {
      return serialized(async () => {
        const [approvedState, scheduleState, markers] =
          await Promise.all([
            loadState(
              storage,
              APPROVED_REVIEW_ITEMS_STORAGE_KEY,
              approvedStateSchema,
              emptyApprovedState,
            ) as Promise<{
              version: 1;
              records: ApprovedReviewItem[];
            }>,
            loadState(
              storage,
              REVIEW_SCHEDULES_STORAGE_KEY,
              scheduleStateSchema,
              emptyScheduleState,
            ),
            loadOptionalState(
              storage,
              REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
              revalidationMarkersSchema,
            ),
          ]);
        return {
          approvedItems: approvedState.records,
          schedules: scheduleState.records,
          pendingReviewItemIds:
            markers === null
              ? []
              : Object.values(markers.records).map(
                  (marker) => marker.reviewItemId,
                ),
        };
      });
    },

    setProductiveUseIntent(
      learningItemId,
      enabled,
      atomicStorageItems = {},
    ) {
      return serialized(async () => {
        const parsedLearningItemId = z.string().min(1).parse(learningItemId);
        const hasAtomicStorageItems =
          Object.keys(atomicStorageItems).length > 0;
        if (!enabled) {
          const [approvedState, sessionState, evidenceState] =
            await loadSessionRecords(storage);
          const productiveReviewItemIds = new Set(
            approvedState.records
              .filter(
                (item) =>
                  item.learningItemId === parsedLearningItemId &&
                  item.knowledgeDimension === 'productive-use',
              )
              .map((item) => item.id),
          );
          if (productiveReviewItemIds.size === 0) {
            if (hasAtomicStorageItems) await storage.set(atomicStorageItems);
            return;
          }
          let changed = false;
          const nextSessions = sessionState.records.flatMap((session) => {
            if (session.status !== 'active') return [session];
            const answeredReviewItemIds = new Set(
              evidenceState.records
                .filter((record) => record.sessionId === session.id)
                .map((record) => record.reviewItemId),
            );
            const retainedReviewItemIds = session.reviewItemIds.filter(
              (reviewItemId) =>
                !productiveReviewItemIds.has(reviewItemId) ||
                answeredReviewItemIds.has(reviewItemId),
            );
            if (
              retainedReviewItemIds.length === session.reviewItemIds.length
            ) {
              return [session];
            }
            changed = true;
            if (retainedReviewItemIds.length === 0) return [];
            const retainedBeforeCurrent = session.reviewItemIds
              .slice(0, session.currentIndex)
              .filter((reviewItemId) =>
                retainedReviewItemIds.includes(reviewItemId),
              ).length;
            if (retainedBeforeCurrent >= retainedReviewItemIds.length) {
              return [
                sessionSchema.parse({
                  ...session,
                  status: 'completed',
                  completedAt: now(),
                  reviewItemIds: retainedReviewItemIds,
                  currentIndex: retainedReviewItemIds.length - 1,
                  revealedReviewItemIds:
                    session.revealedReviewItemIds.filter((reviewItemId) =>
                      retainedReviewItemIds.includes(reviewItemId),
                    ),
                }),
              ];
            }
            return [
              sessionSchema.parse({
                ...session,
                reviewItemIds: retainedReviewItemIds,
                currentIndex: retainedBeforeCurrent,
                revealedReviewItemIds: session.revealedReviewItemIds.filter(
                  (reviewItemId) =>
                    retainedReviewItemIds.includes(reviewItemId),
                ),
              }),
            ];
          });
          if (changed || hasAtomicStorageItems) {
            await storage.set({
              ...atomicStorageItems,
              ...(changed
                ? {
                    [REVIEW_SESSIONS_STORAGE_KEY]: {
                      version: 1,
                      records: nextSessions,
                    },
                  }
                : {}),
            });
          }
          return;
        }
        const scheduleState = await loadState(
          storage,
          REVIEW_SCHEDULES_STORAGE_KEY,
          scheduleStateSchema,
          emptyScheduleState,
        );
        const nextSchedule = scheduleSchema.parse({
          version: 1,
          learningItemId: parsedLearningItemId,
          knowledgeDimension: 'productive-use',
          dueAt: now(),
          demonstratedCount: 0,
          intervalStage: 0,
        });
        if (
          scheduleState.records.some(
            (record) =>
              scheduleIdentity(record) === scheduleIdentity(nextSchedule),
          )
        ) {
          if (hasAtomicStorageItems) await storage.set(atomicStorageItems);
          return;
        }
        await storage.set({
          ...atomicStorageItems,
          [REVIEW_SCHEDULES_STORAGE_KEY]: {
            version: 1,
            records: [...scheduleState.records, nextSchedule],
          },
        });
      });
    },

    start(learningItems) {
      return serialized(async () => {
        const parsedLearningItems = z.array(learningItemSchema).parse(learningItems);
        const [approvedState, scheduleState, sessionState, evidenceState, markers] =
          await Promise.all([
            loadState(
              storage,
              APPROVED_REVIEW_ITEMS_STORAGE_KEY,
              approvedStateSchema,
              emptyApprovedState,
            ) as Promise<{ version: 1; records: ApprovedReviewItem[] }>,
            loadState(
              storage,
              REVIEW_SCHEDULES_STORAGE_KEY,
              scheduleStateSchema,
              emptyScheduleState,
            ),
            loadState(
              storage,
              REVIEW_SESSIONS_STORAGE_KEY,
              sessionStateSchema,
              emptySessionState,
            ),
            loadState(
              storage,
              REVIEW_EVIDENCE_STORAGE_KEY,
              evidenceStateSchema,
              emptyEvidenceState,
            ),
            loadOptionalState(
              storage,
              REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
              revalidationMarkersSchema,
            ),
          ]);
        const activeSession = sessionState.records.find(
          (session) => session.status === 'active',
        );
        if (activeSession !== undefined) {
          return {
            status: 'active' as const,
            session: sessionView(
              activeSession,
              approvedState.records,
              evidenceState.records,
            ),
          };
        }
        const eligible = eligibleReviewItems(
          approvedState.records,
          scheduleState.records,
          markers,
          parsedLearningItems,
          now(),
        );
        const selected = eligible.slice(0, 5);
        if (selected.length === 0) {
          return { status: 'unavailable' as const, eligibleCount: 0 as const };
        }
        const startedAt = now();
        const session = sessionSchema.parse({
          version: 1,
          id: id(),
          status: 'active',
          startedAt,
          completedAt: null,
          reviewItemIds: selected.map(({ item }) => item.id),
          currentIndex: 0,
          revealedReviewItemIds: [],
        });
        await storage.set({
          [REVIEW_SESSIONS_STORAGE_KEY]: {
            version: 1,
            records: [...sessionState.records, session],
          },
        });
        return {
          status: 'started' as const,
          session: sessionView(
            session,
            approvedState.records,
            evidenceState.records,
          ),
        };
      });
    },

    answer(sessionId, rawInput) {
      return serialized(async () => {
        const input = answerInputSchema.parse(rawInput);
        const [approvedState, scheduleState, sessionState, evidenceState] =
          await Promise.all([
            loadState(
              storage,
              APPROVED_REVIEW_ITEMS_STORAGE_KEY,
              approvedStateSchema,
              emptyApprovedState,
            ) as Promise<{ version: 1; records: ApprovedReviewItem[] }>,
            loadState(
              storage,
              REVIEW_SCHEDULES_STORAGE_KEY,
              scheduleStateSchema,
              emptyScheduleState,
            ),
            loadState(
              storage,
              REVIEW_SESSIONS_STORAGE_KEY,
              sessionStateSchema,
              emptySessionState,
            ),
            loadState(
              storage,
              REVIEW_EVIDENCE_STORAGE_KEY,
              evidenceStateSchema,
              emptyEvidenceState,
            ),
          ]);
        const session = requireActiveSession(sessionState.records, sessionId);
        const reviewItemId = session.reviewItemIds[session.currentIndex];
        const item = approvedState.records.find(
          (candidate) => candidate.id === reviewItemId,
        );
        if (reviewItemId === undefined || item === undefined) {
          throw new Error('Review Session has no current approved Review Item.');
        }
        const existingEvidence = evidenceState.records.find(
          (record) =>
            record.sessionId === session.id &&
            record.reviewItemId === reviewItemId,
        );
        if (existingEvidence !== undefined) {
          throw new Error('The current Review Item already has Review Evidence.');
        }
        const scheduleIndex = scheduleState.records.findIndex(
          (candidate) => scheduleIdentity(candidate) === scheduleIdentity(item),
        );
        const schedule = scheduleState.records[scheduleIndex];
        if (schedule === undefined) {
          throw new Error('Review Item has no Review Schedule.');
        }
        const history = evidenceState.records.filter(
          (record) =>
            record.learningItemId === item.learningItemId &&
            record.knowledgeDimension === item.knowledgeDimension,
        );
        const attemptKind =
          item.knowledgeDimension === 'productive-use'
            ? 'objective'
            : calibrationFor(history).nextAttempt;
        if (attemptKind === 'objective' && input.responseText === undefined) {
          throw new Error('An objective Review attempt requires an overt response.');
        }
        const evidenceId = id();
        if (
          evidenceState.records.some((record) => record.id === evidenceId)
        ) {
          throw new Error(`Review Evidence ${evidenceId} already exists.`);
        }
        const recordedAt = now();
        const judgment =
          attemptKind === 'objective'
            ? reviewJudgmentSchema.parse(
                await evaluator.evaluate({
                  item,
                  responseText: input.responseText!,
                }),
              )
            : undefined;
        const evidence = reviewEvidenceSchema.parse({
          version: item.provenance.sourceAuthority === undefined ? 1 : 2,
          id: evidenceId,
          learningItemId: item.learningItemId,
          reviewItemId: item.id,
          sessionId: session.id,
          knowledgeDimension: item.knowledgeDimension,
          recordedAt,
          ...(item.provenance.sourceAuthority === undefined
            ? {}
            : { sourceAuthority: item.provenance.sourceAuthority }),
          kind: attemptKind,
          responseMethod:
            item.knowledgeDimension === 'productive-use'
              ? 'overt-production'
              : attemptKind === 'objective'
                ? 'overt-response'
                : 'covert-recall',
          retrievalFluency: input.retrievalFluency,
          ...(attemptKind === 'objective'
            ? { responseText: input.responseText, judgment }
            : {}),
        });
        const scheduleTransition = transitionReviewSchedule(
          schedule,
          evidence.kind === 'objective'
            ? { kind: 'objective', judgment: evidence.judgment }
            : {
                kind: 'self-assessed',
                retrievalFluency: evidence.retrievalFluency,
              },
          recordedAt,
        );
        const recordedEvidence = recordedEvidenceSchema.parse({
          ...evidence,
          scheduleTransition,
        });
        const nextSession = sessionSchema.parse({
          ...session,
          revealedReviewItemIds: session.revealedReviewItemIds.includes(
            reviewItemId,
          )
            ? session.revealedReviewItemIds
            : [...session.revealedReviewItemIds, reviewItemId],
        });
        const nextEvidence = [...evidenceState.records, recordedEvidence];
        const nextSchedules = scheduleState.records.map((record, index) =>
          index === scheduleIndex
            ? scheduleSchema.parse({
                ...record,
                ...scheduleTransition.next,
              })
            : record,
        );
        await storage.set({
          [REVIEW_EVIDENCE_STORAGE_KEY]: {
            version: 1,
            records: nextEvidence,
          },
          [REVIEW_SCHEDULES_STORAGE_KEY]: {
            version: 1,
            records: nextSchedules,
          },
          [REVIEW_SESSIONS_STORAGE_KEY]: {
            version: 1,
            records: sessionState.records.map((record) =>
              record.id === nextSession.id ? nextSession : record,
            ),
          },
        });
        return {
          status: 'revealed' as const,
          session: sessionView(
            nextSession,
            approvedState.records,
            nextEvidence,
          ),
        };
      });
    },

    advance(sessionId) {
      return serialized(async () => {
        const [approvedState, sessionState, evidenceState] =
          await loadSessionRecords(storage);
        const session = requireActiveSession(sessionState.records, sessionId);
        const reviewItemId = session.reviewItemIds[session.currentIndex];
        const hasEvidence = evidenceState.records.some(
          (record) =>
            record.sessionId === session.id &&
            record.reviewItemId === reviewItemId,
        );
        if (reviewItemId === undefined || !hasEvidence) {
          throw new Error(
            'Record Review Evidence for the current Review Item before advancing.',
          );
        }
        const isComplete =
          session.currentIndex === session.reviewItemIds.length - 1;
        const next = sessionSchema.parse(
          isComplete
            ? {
                ...session,
                status: 'completed',
                completedAt: now(),
              }
            : {
                ...session,
                currentIndex: session.currentIndex + 1,
              },
        );
        await saveSession(storage, sessionState.records, next);
        return {
          status: next.status,
          session: sessionView(
            next,
            approvedState.records,
            evidenceState.records,
          ),
        };
      });
    },

    snapshot(learningItems) {
      return serialized(async () => {
        const parsedLearningItems = z.array(learningItemSchema).parse(learningItems);
        const [approvedState, scheduleState, sessionState, evidenceState, markers] =
          await Promise.all([
            loadState(
              storage,
              APPROVED_REVIEW_ITEMS_STORAGE_KEY,
              approvedStateSchema,
              emptyApprovedState,
            ) as Promise<{ version: 1; records: ApprovedReviewItem[] }>,
            loadState(
              storage,
              REVIEW_SCHEDULES_STORAGE_KEY,
              scheduleStateSchema,
              emptyScheduleState,
            ),
            loadState(
              storage,
              REVIEW_SESSIONS_STORAGE_KEY,
              sessionStateSchema,
              emptySessionState,
            ),
            loadState(
              storage,
              REVIEW_EVIDENCE_STORAGE_KEY,
              evidenceStateSchema,
              emptyEvidenceState,
            ),
            loadOptionalState(
              storage,
              REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
              revalidationMarkersSchema,
            ),
          ]);
        const activeSession = sessionState.records.find(
          (session) => session.status === 'active',
        );
        return {
          eligibleCount: eligibleReviewItems(
            approvedState.records,
            scheduleState.records,
            markers,
            parsedLearningItems,
            now(),
          ).length,
          activeSession:
            activeSession === undefined
              ? null
              : sessionView(
                  activeSession,
                  approvedState.records,
                  evidenceState.records,
                ),
          schedules: scheduleState.records,
          evidence: evidenceState.records,
        };
      });
    },
  };
}

function scheduleIdentity(value: {
  learningItemId: string;
  knowledgeDimension: string;
}): string {
  return `${value.learningItemId}:${value.knowledgeDimension}`;
}

function sessionView(
  session: ReviewSessionRecord,
  approvedItems: readonly ApprovedReviewItem[],
  evidenceRecords: readonly RecordedReviewEvidence[],
): ReviewSessionView {
  const reviewItemId =
    session.status === 'completed'
      ? undefined
      : session.reviewItemIds[session.currentIndex];
  const item =
    reviewItemId === undefined
      ? undefined
      : approvedItems.find((candidate) => candidate.id === reviewItemId);
  if (reviewItemId !== undefined && item === undefined) {
    throw new Error(`Review Session references missing Review Item ${reviewItemId}.`);
  }
  const evidence =
    item === undefined
      ? undefined
      : evidenceRecords.find(
          (record) =>
            record.sessionId === session.id && record.reviewItemId === item.id,
        );
  const history =
    item === undefined
      ? []
      : evidenceRecords.filter(
          (record) =>
            record.learningItemId === item.learningItemId &&
            record.knowledgeDimension === item.knowledgeDimension &&
            record !== evidence,
        );
  const baseCurrent =
    item === undefined
      ? null
      : {
          reviewItemId: item.id,
          learningItemId: item.learningItemId,
          knowledgeDimension: item.knowledgeDimension,
          taskType: item.task.type,
          prompt: item.task.prompt,
          contextQuote: item.task.contextQuote,
          attemptKind:
            item.knowledgeDimension === 'productive-use'
              ? 'objective'
              : (evidence?.kind ?? calibrationFor(history).nextAttempt),
        };
  return {
    id: session.id,
    status: session.status,
    total: session.reviewItemIds.length,
    shortened: session.reviewItemIds.length < 5,
    reviewItemIds: [...session.reviewItemIds],
    position: Math.min(session.currentIndex + 1, session.reviewItemIds.length),
    current:
      baseCurrent === null
        ? null
        : evidence !== undefined
          ? {
              ...baseCurrent,
              revealed: true,
              targetAnswers: [...item!.task.targetAnswers],
              acceptableAlternativeAnswers: [
                ...item!.task.acceptableAlternativeAnswers,
              ],
              partialAnswers: [...item!.task.partialAnswers],
              distractors:
                item!.task.type === 'contrastive'
                  ? [...item!.task.distractors]
                  : [],
              correctiveExplanation: item!.task.correctiveExplanation,
              evidence,
            }
          : { ...baseCurrent, revealed: false },
  };
}

function compareRankedReviewItems(
  left: {
    item: ApprovedReviewItem;
    learningItem: { id: string; createdAt: string };
    schedule: ReviewSchedule;
  },
  right: {
    item: ApprovedReviewItem;
    learningItem: { id: string; createdAt: string };
    schedule: ReviewSchedule;
  },
): number {
  return (
    compareInstants(left.schedule.dueAt, right.schedule.dueAt) ||
    left.schedule.demonstratedCount - right.schedule.demonstratedCount ||
    left.schedule.intervalStage - right.schedule.intervalStage ||
    compareInstants(left.learningItem.createdAt, right.learningItem.createdAt) ||
    compareText(left.learningItem.id, right.learningItem.id) ||
    compareText(
      left.item.knowledgeDimension,
      right.item.knowledgeDimension,
    ) ||
    compareText(left.item.id, right.item.id)
  );
}

function eligibleReviewItems(
  approvedItems: readonly ApprovedReviewItem[],
  schedules: readonly ReviewSchedule[],
  markers: z.infer<typeof revalidationMarkersSchema> | null,
  learningItems: readonly z.infer<typeof learningItemSchema>[],
  asOf: string,
): Array<{
  item: ApprovedReviewItem;
  learningItem: z.infer<typeof learningItemSchema>;
  schedule: ReviewSchedule;
}> {
  const learningItemById = new Map(
    learningItems.map((item) => [item.id, item]),
  );
  const scheduleByIdentity = new Map(
    schedules.map((schedule) => [scheduleIdentity(schedule), schedule]),
  );
  const pendingReviewItemIds = new Set(
    markers === null
      ? []
      : Object.values(markers.records).map((marker) => marker.reviewItemId),
  );
  const ranked = approvedItems
    .flatMap((item) => {
      const learningItem = learningItemById.get(item.learningItemId);
      const schedule = scheduleByIdentity.get(scheduleIdentity(item));
      return learningItem?.status === 'active' &&
        (item.knowledgeDimension !== 'productive-use' ||
          learningItem.productiveUseIntent === true) &&
        schedule !== undefined &&
        Date.parse(schedule.dueAt) <= Date.parse(asOf) &&
        !pendingReviewItemIds.has(item.id)
        ? [{ item, learningItem, schedule }]
        : [];
    })
    .sort(compareRankedReviewItems);
  const seenLearningItems = new Set<string>();
  return ranked.filter(({ item }) => {
    if (seenLearningItems.has(item.learningItemId)) return false;
    seenLearningItems.add(item.learningItemId);
    return true;
  });
}
function compareInstants(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}


function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function loadState<T>(
  storage: ReviewSessionStorage,
  key: string,
  schema: z.ZodType<T>,
  empty: () => T,
): Promise<T> {
  const stored = await storage.get(key);
  const raw = stored[key];
  return raw === undefined ? empty() : schema.parse(raw);
}

async function loadOptionalState<T>(
  storage: ReviewSessionStorage,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const stored = await storage.get(key);
  const raw = stored[key];
  return raw === undefined ? null : schema.parse(raw);
}


async function loadSessionRecords(
  storage: ReviewSessionStorage,
): Promise<
  [
    { version: 1; records: ApprovedReviewItem[] },
    z.infer<typeof sessionStateSchema>,
    z.infer<typeof evidenceStateSchema>,
  ]
> {
  return Promise.all([
    loadState(
      storage,
      APPROVED_REVIEW_ITEMS_STORAGE_KEY,
      approvedStateSchema,
      emptyApprovedState,
    ) as Promise<{ version: 1; records: ApprovedReviewItem[] }>,
    loadState(
      storage,
      REVIEW_SESSIONS_STORAGE_KEY,
      sessionStateSchema,
      emptySessionState,
    ),
    loadState(
      storage,
      REVIEW_EVIDENCE_STORAGE_KEY,
      evidenceStateSchema,
      emptyEvidenceState,
    ),
  ]);
}

function requireActiveSession(
  sessions: readonly ReviewSessionRecord[],
  sessionId: string,
): ReviewSessionRecord {
  const session = sessions.find(
    (candidate) =>
      candidate.id === sessionId && candidate.status === 'active',
  );
  if (session === undefined) {
    throw new Error(`Active Review Session ${sessionId} was not found.`);
  }
  return session;
}

async function saveSession(
  storage: ReviewSessionStorage,
  sessions: readonly ReviewSessionRecord[],
  next: ReviewSessionRecord,
): Promise<void> {
  await storage.set({
    [REVIEW_SESSIONS_STORAGE_KEY]: {
      version: 1,
      records: sessions.map((session) =>
        session.id === next.id ? next : session,
      ),
    },
  });
}

const deterministicReviewEvaluator: ReviewResponseEvaluator = {
  async evaluate({ item, responseText }): Promise<ReviewJudgment> {
    const response = normalizeReviewAnswer(responseText);
    if (
      item.task.targetAnswers.some(
        (accepted) => normalizeReviewAnswer(accepted) === response,
      )
    ) {
      return 'demonstrated';
    }
    if (
      item.task.acceptableAlternativeAnswers.some(
        (alternative) => normalizeReviewAnswer(alternative) === response,
      )
    ) {
      return 'acceptable-alternative';
    }
    if (
      item.task.partialAnswers.some(
        (partial) => normalizeReviewAnswer(partial) === response,
      )
    ) {
      return 'partial';
    }
    if (
      item.task.type === 'contrastive' &&
      item.task.distractors.some(
        (distractor) => normalizeReviewAnswer(distractor) === response,
      )
    ) {
      return 'not-demonstrated';
    }
    return 'unable-to-grade';
  },
};
