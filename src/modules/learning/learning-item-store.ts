import { z } from 'zod';
import { parseDeepDive } from '../reading-flow/deep-dive';
import { parseQuickHint } from '../reading-flow/quick-hint';
import { selectionSchema } from '../reading-flow/selection-parser';
import type { LookupRecord, LookupRecordAction } from './lookup-record';
import { sensePinSchema, type SensePin } from './sense-pin';

export const LEARNING_STATE_STORAGE_KEY = 'learningStateV1';

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('quick-hint'), result: z.unknown() }).strict(),
  z.object({ type: z.literal('deep-dive'), result: z.unknown() }).strict(),
]);
const activeLearningItemSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    expression: z.string().min(1),
    normalizedExpression: z.string().min(1),
    sensePin: sensePinSchema.nullable(),
    productiveUseIntent: z.boolean(),
    createdAt: z.string().datetime(),
    status: z.literal('active'),
  })
  .strict();
const mergedLearningItemSchema = activeLearningItemSchema
  .omit({ status: true })
  .extend({
    status: z.literal('merged'),
    mergedIntoLearningItemId: z.string().min(1),
  })
  .strict();
const learningItemSchema = z.discriminatedUnion('status', [
  activeLearningItemSchema,
  mergedLearningItemSchema,
]);
const encounterSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    learningItemId: z.string().min(1),
    lookupRecordId: z.string().min(1),
    selection: selectionSchema,
    action: actionSchema,
    completedAt: z.string().datetime(),
    savedAt: z.string().datetime(),
    sourceUrl: z.string().url().optional(),
    sensePin: sensePinSchema.nullable(),
  })
  .strict();
const mergeSuggestionBase = {
  version: z.literal(1),
  id: z.string().min(1),
  sourceLearningItemId: z.string().min(1),
  targetLearningItemId: z.string().min(1),
  reason: z.string().min(1),
  createdAt: z.string().datetime(),
};
const pendingMergeSuggestionSchema = z
  .object({
    ...mergeSuggestionBase,
    status: z.literal('pending'),
  })
  .strict();
const resolvedSuggestionSchema = z
  .object({
    ...mergeSuggestionBase,
    status: z.enum(['merged', 'kept-separate']),
    resolutionMutationId: z.string().min(1),
  })
  .strict();
const supersededSuggestionSchema = z
  .object({
    ...mergeSuggestionBase,
    status: z.literal('superseded'),
    supersededByMutationId: z.string().min(1),
  })
  .strict();
const mergeSuggestionSchema = z.discriminatedUnion('status', [
  pendingMergeSuggestionSchema,
  resolvedSuggestionSchema,
  supersededSuggestionSchema,
]);
const mergeMutationSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    type: z.enum(['auto-merge', 'learner-merge']),
    sourceLearningItemId: z.string().min(1),
    targetLearningItemId: z.string().min(1),
    encounterIds: z.array(z.string().min(1)).min(1),
    targetEncounterIds: z.array(z.string().min(1)),
    createdAt: z.string().datetime(),
    undoneAt: z.string().datetime().nullable(),
  })
  .strict();
const keepSeparateMutationSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    type: z.literal('keep-separate'),
    suggestionId: z.string().min(1),
    sourceLearningItemId: z.string().min(1),
    targetLearningItemId: z.string().min(1),
    createdAt: z.string().datetime(),
    undoneAt: z.string().datetime().nullable(),
  })
  .strict();
const encounterReclassificationSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    type: z.literal('encounter-reclassification'),
    encounterId: z.string().min(1),
    sourceLearningItemId: z.string().min(1),
    targetLearningItemId: z.string().min(1),
    supersededSuggestionIds: z.array(z.string().min(1)),
    createdAt: z.string().datetime(),
    undoneAt: z.string().datetime().nullable(),
  })
  .strict();
const learningMutationSchema = z.discriminatedUnion('type', [
  mergeMutationSchema,
  keepSeparateMutationSchema,
  encounterReclassificationSchema,
]);
const storedStateSchema = z
  .object({
    version: z.literal(1),
    learningItems: z.array(learningItemSchema),
    encounters: z.array(encounterSchema),
    mergeSuggestions: z.array(mergeSuggestionSchema),
    history: z.array(learningMutationSchema),
  })
  .strict();

export type LearningItem = z.infer<typeof learningItemSchema>;
export type Encounter = Omit<z.infer<typeof encounterSchema>, 'action'> & {
  action: LookupRecordAction;
};
export type MergeSuggestion = z.infer<typeof mergeSuggestionSchema>;
export type LearningMutation = z.infer<typeof learningMutationSchema>;
export type LearningState = {
  learningItems: LearningItem[];
  encounters: Encounter[];
  mergeSuggestions: MergeSuggestion[];
  history: LearningMutation[];
};
export type EligibleSenseCandidate = {
  sourceSenseId: string;
  morphology: string;
  partOfSpeech: string;
};
export type EligibleSenseQuery = {
  lookupRecordId: string;
  normalizedExpression: string;
};
export type EligibleSenseLookupResult = {
  evidencePackVersion: string;
  candidates: EligibleSenseCandidate[];
};
export type EligibleSenseLookup = {
  findEligibleSenses(
    query: EligibleSenseQuery,
  ): Promise<EligibleSenseLookupResult | null>;
};
export type LearningStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
export type LearningRecordKind =
  | 'learning-item'
  | 'encounter'
  | 'merge-suggestion'
  | 'learning-mutation';
export type SaveLookupResult = {
  outcome: 'created-separate' | 'auto-merged' | 'already-saved';
  learningItemId: string;
  encounterId: string;
};

export type ProductiveUseSchedulePort = {
  setProductiveUseIntent(
    learningItemId: string,
    enabled: boolean,
    atomicStorageItems: Record<string, unknown>,
  ): Promise<void>;
};

const emptyState = (): LearningState => ({
  learningItems: [],
  encounters: [],
  mergeSuggestions: [],
  history: [],
});

export function createLearningItemStore(
  storage: LearningStorage,
  evidence: EligibleSenseLookup,
  dependencies: {
    id?: (kind: LearningRecordKind) => string;
    now?: () => string;
    productiveUseSchedule?: ProductiveUseSchedulePort;
  } = {},
): {
  load(): Promise<LearningState>;
  saveLookup(lookup: LookupRecord): Promise<SaveLookupResult>;
  resolveMergeSuggestion(
    suggestionId: string,
    decision: 'merge' | 'keep-separate',
  ): Promise<MergeSuggestion>;
  setProductiveUseIntent(
    learningItemId: string,
    enabled: boolean,
  ): Promise<LearningItem>;
  reclassifyEncounter(
    encounterId: string,
    targetLearningItemId: string,
  ): Promise<LearningMutation>;
  undoMutation(mutationId: string): Promise<LearningMutation>;
} {
  const id = dependencies.id ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date().toISOString());
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

  const loadUnsafe = async (): Promise<LearningState> => {
    const stored = await storage.get(LEARNING_STATE_STORAGE_KEY);
    const raw = stored[LEARNING_STATE_STORAGE_KEY];
    if (raw === undefined) return emptyState();
    const parsed = storedStateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error('Stored Learning state is invalid; existing data was not changed.');
    }
    return {
      learningItems: parsed.data.learningItems,
      encounters: parsed.data.encounters.map((encounter) => ({
        ...encounter,
        action:
          encounter.action.type === 'quick-hint'
            ? {
                type: 'quick-hint',
                result: parseQuickHint(encounter.action.result),
              }
            : {
                type: 'deep-dive',
                result: parseDeepDive(encounter.action.result),
              },
      })),
      mergeSuggestions: parsed.data.mergeSuggestions,
      history: parsed.data.history,
    };
  };

  const save = (state: LearningState): Promise<void> =>
    storage.set({
      [LEARNING_STATE_STORAGE_KEY]: { version: 1, ...state },
    });

  return {
    load() {
      return serialized(loadUnsafe);
    },

    saveLookup(lookup) {
      return serialized(async () => {
        const state = await loadUnsafe();
        const existingEncounter = state.encounters.find(
          (encounter) => encounter.lookupRecordId === lookup.id,
        );
        if (existingEncounter !== undefined) {
          return {
            outcome: 'already-saved',
            learningItemId: existingEncounter.learningItemId,
            encounterId: existingEncounter.id,
          };
        }

        const normalizedExpression = normalizeExpression(lookup.selection.text);
        const sensePin = await resolveSensePin(
          evidence,
          lookup.id,
          normalizedExpression,
        );
        const timestamp = now();
        const learningItemId = id('learning-item');
        const encounterId = id('encounter');
        const eligibleTargets = state.learningItems
          .filter(
            (item): item is Extract<LearningItem, { status: 'active' }> =>
              item.status === 'active' &&
              item.normalizedExpression === normalizedExpression &&
              sensePinsMatch(item.sensePin, sensePin),
          )
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) ||
              left.id.localeCompare(right.id),
          );
        const target = eligibleTargets.length === 1 ? eligibleTargets[0] : undefined;
        const suggestionTarget = state.learningItems
          .filter(
            (item): item is Extract<LearningItem, { status: 'active' }> =>
              item.status === 'active' &&
              item.normalizedExpression === normalizedExpression,
          )
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) ||
              left.id.localeCompare(right.id),
          )[0];
        const learningItem: LearningItem =
          target === undefined
            ? {
                version: 1,
                id: learningItemId,
                expression: lookup.selection.text,
                normalizedExpression,
                sensePin,
                productiveUseIntent: false,
                createdAt: timestamp,
                status: 'active',
              }
            : {
                version: 1,
                id: learningItemId,
                expression: lookup.selection.text,
                normalizedExpression,
                sensePin,
                productiveUseIntent: false,
                createdAt: timestamp,
                status: 'merged',
                mergedIntoLearningItemId: target.id,
              };
        const encounter: Encounter = {
          version: 1,
          id: encounterId,
          learningItemId: target?.id ?? learningItemId,
          lookupRecordId: lookup.id,
          selection: lookup.selection,
          action: lookup.action,
          completedAt: lookup.completedAt,
          savedAt: timestamp,
          ...(lookup.sourceUrl === undefined ? {} : { sourceUrl: lookup.sourceUrl }),
          sensePin,
        };
        const targetEncounterIds =
          target === undefined
            ? []
            : state.encounters
                .filter(
                  (candidate) => candidate.learningItemId === target.id,
                )
                .map((candidate) => candidate.id);
        const next: LearningState = {
          ...state,
          learningItems: [...state.learningItems, learningItem],
          encounters: [...state.encounters, encounter],
          mergeSuggestions:
            target === undefined && suggestionTarget !== undefined
              ? [
                  ...state.mergeSuggestions,
                  {
                    version: 1,
                    id: id('merge-suggestion'),
                    sourceLearningItemId: learningItemId,
                    targetLearningItemId: suggestionTarget.id,
                    reason:
                      '相同 normalized expression 缺少唯一且相同的 Evidence Pack sense pin，必須由 Learner 決定。',
                    createdAt: timestamp,
                    status: 'pending',
                  },
                ]
              : state.mergeSuggestions,
          history:
            target === undefined
              ? state.history
              : [
                  ...state.history,
                  {
                    version: 1,
                    id: id('learning-mutation'),
                    type: 'auto-merge',
                    sourceLearningItemId: learningItemId,
                    targetLearningItemId: target.id,
                    encounterIds: [encounterId],
                    targetEncounterIds,
                    createdAt: timestamp,
                    undoneAt: null,
                  },
                ],
        };
        await save(next);
        return {
          outcome: target === undefined ? 'created-separate' : 'auto-merged',
          learningItemId: target?.id ?? learningItemId,
          encounterId,
        };
      });
    },

    resolveMergeSuggestion(suggestionId, decision) {
      return serialized(async () => {
        const state = await loadUnsafe();
        const suggestion = state.mergeSuggestions.find(
          (candidate) => candidate.id === suggestionId,
        );
        if (suggestion?.status !== 'pending') {
          throw new Error('Merge Suggestion 不存在或已經處理。');
        }
        const source = state.learningItems.find(
          (item) => item.id === suggestion.sourceLearningItemId,
        );
        const target = state.learningItems.find(
          (item) => item.id === suggestion.targetLearningItemId,
        );
        if (source?.status !== 'active' || target?.status !== 'active') {
          throw new Error('Merge Suggestion 的 Learning Item 已經變更。');
        }
        const timestamp = now();
        const mutationId = id('learning-mutation');
        if (decision === 'keep-separate') {
          const resolved: MergeSuggestion = {
            ...suggestion,
            status: 'kept-separate',
            resolutionMutationId: mutationId,
          };
          const mutation: LearningMutation = {
            version: 1,
            id: mutationId,
            type: 'keep-separate',
            suggestionId: suggestion.id,
            sourceLearningItemId: source.id,
            targetLearningItemId: target.id,
            createdAt: timestamp,
            undoneAt: null,
          };
          await save({
            ...state,
            mergeSuggestions: state.mergeSuggestions.map((candidate) =>
              candidate.id === resolved.id ? resolved : candidate,
            ),
            history: [...state.history, mutation],
          });
          return resolved;
        }

        const encounterIds = state.encounters
          .filter((encounter) => encounter.learningItemId === source.id)
          .map((encounter) => encounter.id);
        const targetEncounterIds = state.encounters
          .filter((encounter) => encounter.learningItemId === target.id)
          .map((encounter) => encounter.id);
        if (encounterIds.length === 0) {
          throw new Error('來源 Learning Item 沒有可合併的 Encounter。');
        }
        const resolved: MergeSuggestion = {
          ...suggestion,
          status: 'merged',
          resolutionMutationId: mutationId,
        };
        const mutation: LearningMutation = {
          version: 1,
          id: mutationId,
          type: 'learner-merge',
          sourceLearningItemId: source.id,
          targetLearningItemId: target.id,
          encounterIds,
          targetEncounterIds,
          createdAt: timestamp,
          undoneAt: null,
        };
        const next: LearningState = {
          learningItems: state.learningItems.map((item) =>
            item.id === source.id
              ? {
                  ...source,
                  status: 'merged',
                  mergedIntoLearningItemId: target.id,
                }
              : item,
          ),
          encounters: state.encounters.map((encounter) =>
            encounterIds.includes(encounter.id)
              ? { ...encounter, learningItemId: target.id }
              : encounter,
          ),
          mergeSuggestions: state.mergeSuggestions.map((candidate) =>
            candidate.id === resolved.id ? resolved : candidate,
          ),
          history: [...state.history, mutation],
        };
        await save(next);
        return resolved;
      });
    },

    setProductiveUseIntent(learningItemId, enabled) {
      return serialized(async () => {
        const state = await loadUnsafe();
        const item = state.learningItems.find(
          (candidate) => candidate.id === learningItemId,
        );
        if (item?.status !== 'active') {
          throw new Error('Productive-use Intent 只能設定在 active Learning Item。');
        }
        const updated: LearningItem = {
          ...item,
          productiveUseIntent: enabled,
        };
        const nextState: LearningState = {
          ...state,
          learningItems: state.learningItems.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        };
        const atomicStorageItems = {
          [LEARNING_STATE_STORAGE_KEY]: { version: 1, ...nextState },
        };
        if (dependencies.productiveUseSchedule === undefined) {
          await storage.set(atomicStorageItems);
        } else {
          await dependencies.productiveUseSchedule.setProductiveUseIntent(
            item.id,
            enabled,
            atomicStorageItems,
          );
        }
        return updated;
      });
    },

    reclassifyEncounter(encounterId, targetLearningItemId) {
      return serialized(async () => {
        const state = await loadUnsafe();
        const encounter = state.encounters.find(
          (candidate) => candidate.id === encounterId,
        );
        if (encounter === undefined) {
          throw new Error('Encounter 不存在。');
        }
        if (encounter.learningItemId === targetLearningItemId) {
          throw new Error('Encounter 已經屬於指定的 Learning Item。');
        }
        const source = state.learningItems.find(
          (item) => item.id === encounter.learningItemId,
        );
        const target = state.learningItems.find(
          (item) => item.id === targetLearningItemId,
        );
        if (source?.status !== 'active' || target?.status !== 'active') {
          throw new Error('Encounter 只能在 active Learning Items 之間 reclassify。');
        }
        const sourceWillBeEmpty =
          state.encounters.filter(
            (candidate) => candidate.learningItemId === source.id,
          ).length === 1;
        const supersededSuggestionIds = sourceWillBeEmpty
          ? state.mergeSuggestions
              .filter(
                (suggestion) =>
                  suggestion.status === 'pending' &&
                  (suggestion.sourceLearningItemId === source.id ||
                    suggestion.targetLearningItemId === source.id),
              )
              .map((suggestion) => suggestion.id)
          : [];
        const mutation: LearningMutation = {
          version: 1,
          id: id('learning-mutation'),
          type: 'encounter-reclassification',
          encounterId: encounter.id,
          sourceLearningItemId: source.id,
          targetLearningItemId: target.id,
          supersededSuggestionIds,
          createdAt: now(),
          undoneAt: null,
        };
        await save({
          ...state,
          encounters: state.encounters.map((candidate) =>
            candidate.id === encounter.id
              ? { ...candidate, learningItemId: target.id }
              : candidate,
          ),
          mergeSuggestions: state.mergeSuggestions.map((suggestion) =>
            supersededSuggestionIds.includes(suggestion.id) &&
            suggestion.status === 'pending'
              ? {
                  ...suggestion,
                  status: 'superseded',
                  supersededByMutationId: mutation.id,
                }
              : suggestion,
          ),
          history: [...state.history, mutation],
        });
        return mutation;
      });
    },

    undoMutation(mutationId) {
      return serialized(async () => {
        const state = await loadUnsafe();
        const mutationIndex = state.history.findIndex(
          (candidate) => candidate.id === mutationId,
        );
        const mutation = state.history[mutationIndex];
        if (mutation === undefined || mutation.undoneAt !== null) {
          throw new Error('Learning mutation 不存在或已經復原。');
        }
        let latestActiveMutationIndex = state.history.length - 1;
        while (
          latestActiveMutationIndex >= 0 &&
          state.history[latestActiveMutationIndex]?.undoneAt !== null
        ) {
          latestActiveMutationIndex -= 1;
        }
        if (mutationIndex !== latestActiveMutationIndex) {
          throw new Error(
            'Learning mutations 必須依反向順序復原。',
          );
        }
        if (mutation.type === 'keep-separate') {
          const suggestion = state.mergeSuggestions.find(
            (candidate) =>
              candidate.id === mutation.suggestionId &&
              candidate.status === 'kept-separate' &&
              candidate.resolutionMutationId === mutation.id,
          );
          if (suggestion === undefined) {
            throw new Error('Keep separate decision 已有後續變更，無法安全復原。');
          }
          const undone: LearningMutation = {
            ...mutation,
            undoneAt: now(),
          };
          await save({
            ...state,
            mergeSuggestions: state.mergeSuggestions.map((candidate) =>
              candidate.id === suggestion.id
                ? {
                    version: suggestion.version,
                    id: suggestion.id,
                    sourceLearningItemId: suggestion.sourceLearningItemId,
                    targetLearningItemId: suggestion.targetLearningItemId,
                    reason: suggestion.reason,
                    createdAt: suggestion.createdAt,
                    status: 'pending',
                  }
                : candidate,
            ),
            history: state.history.map((candidate) =>
              candidate.id === undone.id ? undone : candidate,
            ),
          });
          return undone;
        }
        if (mutation.type === 'encounter-reclassification') {
          const encounter = state.encounters.find(
            (candidate) => candidate.id === mutation.encounterId,
          );
          const source = state.learningItems.find(
            (item) => item.id === mutation.sourceLearningItemId,
          );
          const target = state.learningItems.find(
            (item) => item.id === mutation.targetLearningItemId,
          );
          if (
            encounter?.learningItemId !== mutation.targetLearningItemId ||
            source?.status !== 'active' ||
            target?.status !== 'active'
          ) {
            throw new Error('Encounter reclassification 已有後續變更，無法安全復原。');
          }
          const undone: LearningMutation = {
            ...mutation,
            undoneAt: now(),
          };
          await save({
            ...state,
            encounters: state.encounters.map((candidate) =>
              candidate.id === encounter.id
                ? { ...candidate, learningItemId: source.id }
                : candidate,
            ),
            mergeSuggestions: state.mergeSuggestions.map((suggestion) =>
              mutation.supersededSuggestionIds.includes(suggestion.id) &&
              suggestion.status === 'superseded' &&
              suggestion.supersededByMutationId === mutation.id
                ? {
                    version: suggestion.version,
                    id: suggestion.id,
                    sourceLearningItemId: suggestion.sourceLearningItemId,
                    targetLearningItemId: suggestion.targetLearningItemId,
                    reason: suggestion.reason,
                    createdAt: suggestion.createdAt,
                    status: 'pending',
                  }
                : suggestion,
            ),
            history: state.history.map((candidate) =>
              candidate.id === undone.id ? undone : candidate,
            ),
          });
          return undone;
        }
        const source = state.learningItems.find(
          (item) => item.id === mutation.sourceLearningItemId,
        );
        if (
          source?.status !== 'merged' ||
          source.mergedIntoLearningItemId !== mutation.targetLearningItemId
        ) {
          throw new Error('Learning graph 已有後續變更，無法安全復原。');
        }
        const movedEncounters = state.encounters.filter((encounter) =>
          mutation.encounterIds.includes(encounter.id),
        );
        if (
          movedEncounters.length !== mutation.encounterIds.length ||
          movedEncounters.some(
            (encounter) =>
              encounter.learningItemId !== mutation.targetLearningItemId,
          )
        ) {
          throw new Error('Encounter 已有後續 reclassification，無法安全復原。');
        }
        const timestamp = now();
        const undone: LearningMutation = { ...mutation, undoneAt: timestamp };
        const activeSource: LearningItem = {
          version: source.version,
          id: source.id,
          expression: source.expression,
          normalizedExpression: source.normalizedExpression,
          sensePin: source.sensePin,
          productiveUseIntent: source.productiveUseIntent,
          createdAt: source.createdAt,
          status: 'active',
        };
        const next: LearningState = {
          learningItems: state.learningItems.map((item) =>
            item.id === activeSource.id ? activeSource : item,
          ),
          encounters: state.encounters.map((encounter) =>
            mutation.encounterIds.includes(encounter.id)
              ? { ...encounter, learningItemId: source.id }
              : encounter,
          ),
          mergeSuggestions: state.mergeSuggestions.map((suggestion) =>
            suggestion.status === 'merged' &&
            suggestion.resolutionMutationId === mutation.id
              ? {
                  version: suggestion.version,
                  id: suggestion.id,
                  sourceLearningItemId: suggestion.sourceLearningItemId,
                  targetLearningItemId: suggestion.targetLearningItemId,
                  reason: suggestion.reason,
                  createdAt: suggestion.createdAt,
                  status: 'pending',
                }
              : suggestion,
          ),
          history: state.history.map((candidate) =>
            candidate.id === undone.id ? undone : candidate,
          ),
        };
        await save(next);
        return undone;
      });
    },
  };
}

export function normalizeExpression(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en');
}

async function resolveSensePin(
  evidence: EligibleSenseLookup,
  lookupRecordId: string,
  normalizedExpression: string,
): Promise<SensePin | null> {
  let match: EligibleSenseLookupResult | null;
  try {
    match = await evidence.findEligibleSenses({
      lookupRecordId,
      normalizedExpression,
    });
  } catch {
    return null;
  }
  if (match === null || match.evidencePackVersion.length === 0) return null;
  if (match.candidates.length !== 1) return null;
  const candidate = match.candidates[0];
  if (
    candidate === undefined ||
    candidate.sourceSenseId.length === 0 ||
    candidate.morphology.length === 0 ||
    candidate.partOfSpeech.length === 0
  ) {
    return null;
  }
  return {
    evidencePackVersion: match.evidencePackVersion,
    sourceSenseId: candidate.sourceSenseId,
    morphology: candidate.morphology,
    partOfSpeech: candidate.partOfSpeech,
  };
}

function sensePinsMatch(left: SensePin | null, right: SensePin | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.evidencePackVersion === right.evidencePackVersion &&
    left.sourceSenseId === right.sourceSenseId
  );
}
