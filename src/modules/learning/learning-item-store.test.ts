import { describe, expect, it } from 'vitest';
import type { LookupRecord } from './lookup-record';
import {
  createLearningItemStore,
  type LearningStorage,
} from './learning-item-store';

function memoryStorage(initial: Record<string, unknown> = {}): LearningStorage {
  const values = structuredClone(initial);
  return {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(items) {
      Object.assign(values, structuredClone(items));
    },
  };
}

function lookup(
  id: string,
  text: string,
  before: string,
  after: string,
): LookupRecord {
  return {
    version: 1,
    id,
    selection: { text, context: { before, after } },
    action: {
      type: 'quick-hint',
      result: { simplerExpression: 'delay until later', explanationCue: null },
    },
    completedAt: '2026-08-14T12:00:00.000Z',
    usage: { source: 'cache', attempts: 0, provider: null },
    sourceUrl: 'https://example.test/article',
  };
}

describe('Learning Item store', () => {
  it('creates versioned Items and Encounters, then reversibly auto-merges exactly one same-sense match', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      {
        async findEligibleSenses({ normalizedExpression }) {
          return {
            evidencePackVersion: 'oewn-test-2025.1',
            candidates:
              normalizedExpression === 'postpone'
                ? [
                    {
                      sourceSenseId: 'oewn:02642814-v',
                      morphology: 'lemma',
                      partOfSpeech: 'verb',
                    },
                  ]
                : [],
          };
        },
      },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );

    const first = await store.saveLookup(
      lookup('lookup-1', 'Postpone', 'They ', ' the meeting.'),
    );
    const second = await store.saveLookup(
      lookup('lookup-2', '  postpone  ', 'Please ', ' it.'),
    );

    expect(first).toMatchObject({
      outcome: 'created-separate',
      learningItemId: 'learning-item-1',
      encounterId: 'encounter-1',
    });
    expect(second).toMatchObject({
      outcome: 'auto-merged',
      learningItemId: 'learning-item-1',
      encounterId: 'encounter-2',
    });

    const state = await store.load();
    expect(state.learningItems).toEqual([
      expect.objectContaining({
        version: 1,
        id: 'learning-item-1',
        normalizedExpression: 'postpone',
        productiveUseIntent: false,
        status: 'active',
        sensePin: {
          evidencePackVersion: 'oewn-test-2025.1',
          sourceSenseId: 'oewn:02642814-v',
          morphology: 'lemma',
          partOfSpeech: 'verb',
        },
      }),
      expect.objectContaining({
        version: 1,
        id: 'learning-item-2',
        status: 'merged',
        mergedIntoLearningItemId: 'learning-item-1',
      }),
    ]);
    expect(state.encounters).toEqual([
      expect.objectContaining({
        version: 1,
        id: 'encounter-1',
        lookupRecordId: 'lookup-1',
        learningItemId: 'learning-item-1',
      }),
      expect.objectContaining({
        version: 1,
        id: 'encounter-2',
        lookupRecordId: 'lookup-2',
        learningItemId: 'learning-item-1',
        selection: {
          text: '  postpone  ',
          context: { before: 'Please ', after: ' it.' },
        },
      }),
    ]);
    expect(state.history).toEqual([
      expect.objectContaining({
        version: 1,
        id: 'learning-mutation-1',
        type: 'auto-merge',
        sourceLearningItemId: 'learning-item-2',
        targetLearningItemId: 'learning-item-1',
        encounterIds: ['encounter-2'],
        undoneAt: null,
      }),
    ]);

    const reloaded = createLearningItemStore(storage, {
      async findEligibleSenses() {
        return null;
      },
    });
    await expect(reloaded.load()).resolves.toEqual(state);
  });


  it('auto-merges into an active Item whose Encounters were reclassified away', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      {
        async findEligibleSenses({ normalizedExpression }) {
          return {
            evidencePackVersion: 'oewn-test-2025.1',
            candidates: [
              {
                sourceSenseId: `sense:${normalizedExpression}`,
                morphology: 'lemma',
                partOfSpeech: 'noun',
              },
            ],
          };
        },
      },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );
    await store.saveLookup(lookup('lookup-1', 'alpha', '', ''));
    await store.saveLookup(lookup('lookup-2', 'beta', '', ''));
    await store.saveLookup(lookup('lookup-3', 'gamma', '', ''));
    await store.reclassifyEncounter('encounter-2', 'learning-item-3');

    await expect(
      store.saveLookup(lookup('lookup-4', 'Beta', '', '')),
    ).resolves.toMatchObject({
      outcome: 'auto-merged',
      learningItemId: 'learning-item-2',
      encounterId: 'encounter-4',
    });
    const state = await store.load();
    expect(
      state.encounters.find((encounter) => encounter.id === 'encounter-4'),
    ).toMatchObject({
      id: 'encounter-4',
      learningItemId: 'learning-item-2',
    });
    expect(
      state.history.find((mutation) => mutation.id === 'learning-mutation-2'),
    ).toMatchObject({
      type: 'auto-merge',
      targetEncounterIds: [],
    });
  });

  it('leaves multiple eligible morphology and part-of-speech tuples unpinned even when they share a sense ID', async () => {
    const store = createLearningItemStore(
      memoryStorage(),
      {
        async findEligibleSenses() {
          return {
            evidencePackVersion: 'oewn-test-2025.1',
            candidates: [
              {
                sourceSenseId: 'oewn:02642814-v',
                morphology: 'past-tense-of:postpone',
                partOfSpeech: 'verb',
              },
              {
                sourceSenseId: 'oewn:02642814-v',
                morphology: 'participial-adjective-of:postpone',
                partOfSpeech: 'adjective',
              },
            ],
          };
        },
      },
      {
        id: (kind) => `${kind}-1`,
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );

    await store.saveLookup(
      lookup('lookup-1', 'postponed', 'The meeting was ', ' again.'),
    );
    await expect(store.load()).resolves.toMatchObject({
      learningItems: [{ sensePin: null }],
      encounters: [{ sensePin: null }],
    });
  });
  it('keeps uncertain senses separate and creates a non-destructive Merge Suggestion', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      {
        async findEligibleSenses() {
          return {
            evidencePackVersion: 'oewn-test-2025.1',
            candidates: [
              {
                sourceSenseId: 'oewn:02642814-v',
                morphology: 'lemma',
                partOfSpeech: 'verb',
              },
              {
                sourceSenseId: 'oewn:02738188-v',
                morphology: 'lemma',
                partOfSpeech: 'verb',
              },
            ],
          };
        },
      },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );

    await store.saveLookup(
      lookup('lookup-1', 'postpone', 'They ', ' the vote.'),
    );
    const second = await store.saveLookup(
      lookup('lookup-2', 'Postpone', 'Please ', ' this task.'),
    );

    expect(second).toMatchObject({
      outcome: 'created-separate',
      learningItemId: 'learning-item-2',
    });
    const state = await store.load();
    expect(state.learningItems).toMatchObject([
      { id: 'learning-item-1', status: 'active', sensePin: null },
      { id: 'learning-item-2', status: 'active', sensePin: null },
    ]);
    expect(state.encounters).toMatchObject([
      { id: 'encounter-1', learningItemId: 'learning-item-1' },
      { id: 'encounter-2', learningItemId: 'learning-item-2' },
    ]);
    expect(state.mergeSuggestions).toEqual([
      expect.objectContaining({
        version: 1,
        id: 'merge-suggestion-1',
        sourceLearningItemId: 'learning-item-2',
        targetLearningItemId: 'learning-item-1',
        status: 'pending',
        reason:
          '相同 normalized expression 缺少唯一且相同的 Evidence Pack sense pin，必須由 Learner 決定。',
      }),
    ]);
  });

  it('merges by Learner choice and Undo restores the original graph without changing Encounter identity', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      { async findEligibleSenses() { return null; } },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );
    await store.saveLookup(
      lookup('lookup-1', 'postpone', 'They ', ' the vote.'),
    );
    await store.saveLookup(
      lookup('lookup-2', 'Postpone', 'Please ', ' this task.'),
    );
    const reviewEvidenceReference = { encounterId: 'encounter-2' };

    const merged = await store.resolveMergeSuggestion(
      'merge-suggestion-1',
      'merge',
    );
    expect(merged).toMatchObject({
      status: 'merged',
      resolutionMutationId: 'learning-mutation-1',
    });
    let state = await store.load();
    expect(state.learningItems).toMatchObject([
      { id: 'learning-item-1', status: 'active' },
      {
        id: 'learning-item-2',
        status: 'merged',
        mergedIntoLearningItemId: 'learning-item-1',
      },
    ]);
    expect(state.encounters).toMatchObject([
      { id: 'encounter-1', learningItemId: 'learning-item-1' },
      {
        id: reviewEvidenceReference.encounterId,
        lookupRecordId: 'lookup-2',
        learningItemId: 'learning-item-1',
        sourceUrl: 'https://example.test/article',
      },
    ]);
    expect(state.history).toEqual([
      expect.objectContaining({
        id: 'learning-mutation-1',
        type: 'learner-merge',
        encounterIds: ['encounter-2'],
        undoneAt: null,
      }),
    ]);

    await store.undoMutation('learning-mutation-1');
    state = await store.load();
    expect(state.learningItems).toMatchObject([
      { id: 'learning-item-1', status: 'active' },
      { id: 'learning-item-2', status: 'active' },
    ]);
    expect(state.encounters).toMatchObject([
      { id: 'encounter-1', learningItemId: 'learning-item-1' },
      {
        id: reviewEvidenceReference.encounterId,
        lookupRecordId: 'lookup-2',
        learningItemId: 'learning-item-2',
        sourceUrl: 'https://example.test/article',
      },
    ]);
    expect(state.mergeSuggestions).toMatchObject([
      { id: 'merge-suggestion-1', status: 'pending' },
    ]);
    expect(state.history).toMatchObject([
      { id: 'learning-mutation-1', undoneAt: '2026-08-14T13:00:00.000Z' },
    ]);
  });

  it('records Keep separate as an inspectable reversible Learner choice', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      { async findEligibleSenses() { return null; } },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );
    await store.saveLookup(
      lookup('lookup-1', 'postpone', 'They ', ' the vote.'),
    );
    await store.saveLookup(
      lookup('lookup-2', 'Postpone', 'Please ', ' this task.'),
    );

    const kept = await store.resolveMergeSuggestion(
      'merge-suggestion-1',
      'keep-separate',
    );
    expect(kept).toMatchObject({
      status: 'kept-separate',
      resolutionMutationId: 'learning-mutation-1',
    });
    let state = await store.load();
    expect(state.learningItems).toMatchObject([
      { id: 'learning-item-1', status: 'active' },
      { id: 'learning-item-2', status: 'active' },
    ]);
    expect(state.encounters).toMatchObject([
      { id: 'encounter-1', learningItemId: 'learning-item-1' },
      { id: 'encounter-2', learningItemId: 'learning-item-2' },
    ]);
    expect(state.history).toEqual([
      expect.objectContaining({
        id: 'learning-mutation-1',
        type: 'keep-separate',
        suggestionId: 'merge-suggestion-1',
        undoneAt: null,
      }),
    ]);

    await store.undoMutation('learning-mutation-1');
    state = await store.load();
    expect(state.mergeSuggestions).toMatchObject([
      { id: 'merge-suggestion-1', status: 'pending' },
    ]);
    expect(state.history).toMatchObject([
      { id: 'learning-mutation-1', undoneAt: '2026-08-14T13:00:00.000Z' },
    ]);
  });

  it('reclassifies and restores one Encounter without replacing its identity or provenance', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      { async findEligibleSenses() { return null; } },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );
    await store.saveLookup(
      lookup('lookup-1', 'postpone', 'They ', ' the vote.'),
    );
    await store.saveLookup(
      lookup('lookup-2', 'adjourn', 'They will ', ' the meeting.'),
    );
    const reviewEvidenceReference = { encounterId: 'encounter-2' };

    const mutation = await store.reclassifyEncounter(
      reviewEvidenceReference.encounterId,
      'learning-item-1',
    );
    expect(mutation).toMatchObject({
      id: 'learning-mutation-1',
      type: 'encounter-reclassification',
      encounterId: 'encounter-2',
      sourceLearningItemId: 'learning-item-2',
      targetLearningItemId: 'learning-item-1',
      undoneAt: null,
    });
    let state = await store.load();
    expect(state.encounters).toMatchObject([
      { id: 'encounter-1', learningItemId: 'learning-item-1' },
      {
        id: reviewEvidenceReference.encounterId,
        lookupRecordId: 'lookup-2',
        learningItemId: 'learning-item-1',
        selection: {
          text: 'adjourn',
          context: { before: 'They will ', after: ' the meeting.' },
        },
      },
    ]);
    expect(state.learningItems).toMatchObject([
      { id: 'learning-item-1', normalizedExpression: 'postpone', status: 'active' },
      { id: 'learning-item-2', normalizedExpression: 'adjourn', status: 'active' },
    ]);

    await store.undoMutation(mutation.id);
    state = await store.load();
    expect(state.encounters).toMatchObject([
      { id: 'encounter-1', learningItemId: 'learning-item-1' },
      {
        id: reviewEvidenceReference.encounterId,
        lookupRecordId: 'lookup-2',
        learningItemId: 'learning-item-2',
      },
    ]);
    expect(state.history).toMatchObject([
      { id: mutation.id, undoneAt: '2026-08-14T13:00:00.000Z' },
    ]);
  });


  it('supersedes a pending suggestion when reclassification removes its source context and restores it on Undo', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      { async findEligibleSenses() { return null; } },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );
    await store.saveLookup(
      lookup('lookup-1', 'bank', 'river ', ' at sunset'),
    );
    await store.saveLookup(
      lookup('lookup-2', 'Bank', 'the ', ' approved a loan'),
    );
    await store.saveLookup(
      lookup('lookup-3', 'adjourn', 'They ', ' the meeting'),
    );

    const mutation = await store.reclassifyEncounter(
      'encounter-2',
      'learning-item-3',
    );
    let state = await store.load();
    expect(state.mergeSuggestions).toMatchObject([
      {
        id: 'merge-suggestion-1',
        status: 'superseded',
        supersededByMutationId: mutation.id,
      },
    ]);

    await store.undoMutation(mutation.id);
    state = await store.load();
    expect(state.mergeSuggestions).toMatchObject([
      { id: 'merge-suggestion-1', status: 'pending' },
    ]);
  });

  it('rejects non-LIFO Undo when a later active mutation touched the same Encounter', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      { async findEligibleSenses() { return null; } },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );
    await store.saveLookup(lookup('lookup-1', 'alpha', '', ''));
    await store.saveLookup(lookup('lookup-2', 'beta', '', ''));
    await store.saveLookup(lookup('lookup-3', 'gamma', '', ''));

    const first = await store.reclassifyEncounter(
      'encounter-1',
      'learning-item-2',
    );
    await store.reclassifyEncounter('encounter-1', 'learning-item-3');
    await store.reclassifyEncounter('encounter-1', 'learning-item-2');

    await expect(store.undoMutation(first.id)).rejects.toThrow(
      '反向順序',
    );
    const state = await store.load();
    expect(
      state.encounters.find((encounter) => encounter.id === 'encounter-1'),
    ).toMatchObject({
      id: 'encounter-1',
      learningItemId: 'learning-item-2',
    });
    expect(state.history).toMatchObject([
      { id: first.id, undoneAt: null },
      { id: 'learning-mutation-2', undoneAt: null },
      { id: 'learning-mutation-3', undoneAt: null },
    ]);
  });

  it('rejects Undo of any older active mutation to preserve reverse-order history', async () => {
    const storage = memoryStorage();
    const counters = new Map<string, number>();
    const store = createLearningItemStore(
      storage,
      {
        async findEligibleSenses() {
          return {
            evidencePackVersion: 'oewn-test-2025.1',
            candidates: [
              {
                sourceSenseId: 'uncertain',
                morphology: 'lemma',
                partOfSpeech: 'verb',
              },
              {
                sourceSenseId: 'uncertain-2',
                morphology: 'lemma',
                partOfSpeech: 'verb',
              },
            ],
          };
        },
      },
      {
        id(kind) {
          const next = (counters.get(kind) ?? 0) + 1;
          counters.set(kind, next);
          return `${kind}-${next}`;
        },
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );
    await store.saveLookup(lookup('lookup-1', 'postpone', '', ''));
    await store.saveLookup(lookup('lookup-2', 'Postpone', '', ''));
    await store.saveLookup(lookup('lookup-3', 'adjourn', '', ''));
    const keepSeparate = await store.resolveMergeSuggestion(
      'merge-suggestion-1',
      'keep-separate',
    );
    if (keepSeparate.status !== 'kept-separate') {
      throw new Error('Expected Keep separate resolution.');
    }
    await store.reclassifyEncounter('encounter-2', 'learning-item-3');

    await expect(store.undoMutation(keepSeparate.resolutionMutationId)).rejects.toThrow(
      '反向順序',
    );
    await expect(store.load()).resolves.toMatchObject({
      mergeSuggestions: [
        { id: 'merge-suggestion-1', status: 'kept-separate' },
      ],
      history: [
        { id: 'learning-mutation-1', undoneAt: null },
        { id: 'learning-mutation-2', undoneAt: null },
      ],
    });
  });
  it('keeps Productive-use Intent per Item, defaulting off without creating schedule state', async () => {
    const storage = memoryStorage();
    const store = createLearningItemStore(
      storage,
      { async findEligibleSenses() { return null; } },
      {
        id: (kind) => `${kind}-1`,
        now: () => '2026-08-14T13:00:00.000Z',
      },
    );
    await store.saveLookup(
      lookup('lookup-1', 'postpone', 'They ', ' the vote.'),
    );
    await expect(store.load()).resolves.toMatchObject({
      learningItems: [
        {
          id: 'learning-item-1',
          productiveUseIntent: false,
        },
      ],
      history: [],
    });

    await store.setProductiveUseIntent('learning-item-1', true);
    await expect(store.load()).resolves.toMatchObject({
      learningItems: [
        {
          id: 'learning-item-1',
          productiveUseIntent: true,
        },
      ],
      history: [],
    });
    await store.setProductiveUseIntent('learning-item-1', false);
    await expect(store.load()).resolves.toMatchObject({
      learningItems: [
        {
          id: 'learning-item-1',
          productiveUseIntent: false,
        },
      ],
      history: [],
    });
  });
});
