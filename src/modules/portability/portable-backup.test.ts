import { describe, expect, it } from 'vitest';
import { BUNDLED_ENGLISH_EVIDENCE_PACK } from '../evidence/bundled-english-evidence-pack';
import {
  createPortableBackupStore,
  type PortableBackupStorage,
} from './portable-backup';

function memoryStorage(
  initial: Record<string, unknown> = {},
): PortableBackupStorage & { values: Record<string, unknown> } {
  const values = structuredClone(initial);
  return {
    values,
    async get(keys) {
      if (keys === null) return structuredClone(values);
      const selected = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        selected
          .filter((key) => values[key] !== undefined)
          .map((key) => [key, structuredClone(values[key])]),
      );
    },
    async set(items) {
      Object.assign(values, structuredClone(items));
    },
    async getBytesInUse() {
      return new TextEncoder().encode(JSON.stringify(values)).byteLength;
    },
  };
}

const emptyLearning = {
  version: 1,
  learningItems: [],
  encounters: [],
  mergeSuggestions: [],
  history: [],
};
const emptyRecords = { version: 1, records: [] };

describe('Portable backup store', () => {
  it('exports complete inspectable state while excluding credentials and transient data', async () => {
    const storage = memoryStorage({
      lookupRecordsV1: emptyRecords,
      learningStateV1: emptyLearning,
      learnerNotesV1: emptyRecords,
      approvedReviewItemsV1: emptyRecords,
      reviewEvidenceV1: emptyRecords,
      reviewSchedulesV1: emptyRecords,
      reviewSessionsV1: emptyRecords,
      openAiConfiguration: {
        model: { kind: 'curated', id: 'gpt-5.4-mini-2026-03-17' },
        efforts: {
          quickHint: 'low',
          deepDive: 'medium',
          review: 'medium',
        },
        personalInstructions: 'Use concise Traditional Chinese.',
      },
      openAiBudgetSettings: {
        tokenLimit: 100_000,
        estimatedCostUsdLimit: 1,
      },
      activeEvidencePackV1: {
        version: 1,
        activeVersion: '2025.1.0',
        rollbackVersion: null,
        revalidationSweeps: [],
        installedCandidates: { '2025.1.0': 'candidate-secret' },
      },
      openAiApiKey: 'sk-must-never-export',
      openAiBudgetLedger: { reservations: { secret: true } },
      pronunciationSpeechCacheV1: { audio: 'base64-secret-cache' },
      reviewPreparationJobsV1: { jobs: [{ id: 'transient-job' }] },
      'evidencePackCandidateV1:candidate-secret': {
        payload: 'binary-pack-data',
      },
    });
    const backup = createPortableBackupStore(storage, {
      id: () => 'backup-1',
      now: () => '2026-08-16T00:00:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });

    const exported = await backup.exportBackup();
    const text = new TextDecoder().decode(exported.bytes);
    const document = JSON.parse(text) as Record<string, any>;

    expect(exported.filename).toBe(
      'lingo-palette-backup-2026-08-16T00-00-00-000Z.json',
    );
    expect(exported.warning).toContain('未加密');
    expect(document).toMatchObject({
      format: 'lingo-palette-backup',
      version: 1,
      backupId: 'backup-1',
      exportedAt: '2026-08-16T00:00:00.000Z',
      state: {
        lookupRecords: emptyRecords,
        learning: emptyLearning,
        learnerNotes: emptyRecords,
        review: {
          approvedItems: emptyRecords,
          evidence: emptyRecords,
          schedules: emptyRecords,
          sessions: emptyRecords,
        },
        settings: {
          evidencePack: { preferredVersion: '2025.1.0' },
        },
      },
    });
    expect(Object.keys(document.state).sort()).toEqual([
      'learnerNotes',
      'learning',
      'lookupRecords',
      'provenance',
      'review',
      'settings',
    ]);
    expect(text).not.toContain('sk-must-never-export');
    expect(text).not.toContain('base64-secret-cache');
    expect(text).not.toContain('transient-job');
    expect(text).not.toContain('binary-pack-data');
    expect(text).not.toContain('candidate-secret');
  });

  it('stages then atomically restores a fresh profile without replacing its API key or Evidence Pack', async () => {
    const lookup = {
      version: 1,
      id: 'lookup-1',
      selection: {
        text: 'postpone',
        context: {
          before: 'The committee decided to ',
          after: ' the vote.',
        },
      },
      action: {
        type: 'quick-hint',
        result: {
          simplerExpression: 'delay until later',
          explanationCue: '延後',
        },
      },
      completedAt: '2026-08-15T23:00:00.000Z',
      usage: { source: 'cache', attempts: 0, provider: null },
      sourceUrl: 'https://example.test/article',
    };
    const source = memoryStorage({
      lookupRecordsV1: { version: 1, records: [lookup] },
      learningStateV1: emptyLearning,
      learnerNotesV1: emptyRecords,
      approvedReviewItemsV1: emptyRecords,
      reviewEvidenceV1: emptyRecords,
      reviewSchedulesV1: emptyRecords,
      reviewSessionsV1: emptyRecords,
      openAiConfiguration: {
        model: { kind: 'custom', id: 'gpt-custom' },
        efforts: {
          quickHint: 'minimal',
          deepDive: 'low',
          review: 'high',
        },
        personalInstructions: 'Explain briefly.',
      },
      openAiBudgetSettings: {
        tokenLimit: 55_000,
        estimatedCostUsdLimit: 0,
      },
    });
    const sourceBackup = createPortableBackupStore(source, {
      id: () => 'source-backup',
      now: () => '2026-08-16T01:00:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });
    const exported = await sourceBackup.exportBackup();
    const target = memoryStorage({
      openAiApiKey: 'sk-device-only',
      activeEvidencePackV1: {
        version: 1,
        activeVersion: '2026.2.0',
        rollbackVersion: null,
        installedCandidates: {},
        revalidationSweeps: [],
      },
    });
    let nextId = 0;
    const importer = createPortableBackupStore(target, {
      id: (kind) => `${kind}-${(nextId += 1)}`,
      now: () => '2026-08-16T02:00:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });

    const preview = await importer.stageImport(exported.bytes);
    expect(preview).toMatchObject({
      sourceBackupId: 'source-backup',
      counts: {
        added: { 'lookup-record': 1 },
        identicalSkipped: {},
        divergentPreserved: {},
      },
      collisions: [],
    });
    expect(target.values.lookupRecordsV1).toBeUndefined();
    expect(target.values.openAiApiKey).toBe('sk-device-only');
    expect(
      (target.values.activeEvidencePackV1 as { activeVersion: string })
        .activeVersion,
    ).toBe('2026.2.0');

    const report = await importer.commitImport(preview.stageId);
    expect(report.status).toBe('committed');
    expect(target.values.lookupRecordsV1).toEqual({
      version: 1,
      records: [lookup],
    });
    expect(target.values.openAiApiKey).toBe('sk-device-only');
    expect(
      (target.values.activeEvidencePackV1 as { activeVersion: string })
        .activeVersion,
    ).toBe('2026.2.0');
    expect(target.values.openAiConfiguration).toMatchObject({
      model: { kind: 'custom', id: 'gpt-custom' },
      personalInstructions: 'Explain briefly.',
    });
    expect(target.values.openAiBudgetSettings).toEqual({
      tokenLimit: 55_000,
      estimatedCostUsdLimit: 0,
    });
    expect(target.values.importReportsV1).toMatchObject({
      version: 1,
      records: [{ id: report.id, sourceBackupId: 'source-backup' }],
    });
  });

  it('preserves a divergent imported graph with new IDs and imports the same backup idempotently', async () => {
    const makeLookup = (cue: string) => ({
      version: 1 as const,
      id: 'lookup-shared',
      selection: {
        text: 'postpone',
        context: { before: 'Please ', after: ' the vote.' },
      },
      action: {
        type: 'quick-hint' as const,
        result: { simplerExpression: 'delay', explanationCue: cue },
      },
      completedAt: '2026-08-15T23:00:00.000Z',
      usage: { source: 'cache' as const, attempts: 0, provider: null },
    });
    const makeLearning = (expression: string, cue: string) => ({
      version: 1 as const,
      learningItems: [
        {
          version: 1 as const,
          id: 'learning-shared',
          expression,
          normalizedExpression: expression,
          sensePin: null,
          productiveUseIntent: false,
          createdAt: '2026-08-15T23:01:00.000Z',
          status: 'active' as const,
        },
      ],
      encounters: [
        {
          version: 1 as const,
          id: 'encounter-shared',
          learningItemId: 'learning-shared',
          lookupRecordId: 'lookup-shared',
          selection: {
            text: 'postpone',
            context: { before: 'Please ', after: ' the vote.' },
          },
          action: {
            type: 'quick-hint' as const,
            result: { simplerExpression: 'delay', explanationCue: cue },
          },
          completedAt: '2026-08-15T23:00:00.000Z',
          savedAt: '2026-08-15T23:01:00.000Z',
          sensePin: null,
        },
      ],
      mergeSuggestions: [],
      history: [],
    });
    const source = memoryStorage({
      lookupRecordsV1: { version: 1, records: [makeLookup('進口版本')] },
      learningStateV1: makeLearning('postpone imported', '進口版本'),
    });
    const exported = await createPortableBackupStore(source, {
      id: () => 'backup-divergent',
      now: () => '2026-08-16T01:00:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    }).exportBackup();
    const target = memoryStorage({
      lookupRecordsV1: { version: 1, records: [makeLookup('本機版本')] },
      learningStateV1: makeLearning('postpone local', '本機版本'),
    });
    const counters = new Map<string, number>();
    const importer = createPortableBackupStore(target, {
      id: (kind) => {
        const next = (counters.get(kind) ?? 0) + 1;
        counters.set(kind, next);
        return `${kind}-${next}`;
      },
      now: () => '2026-08-16T02:00:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });

    const preview = await importer.stageImport(exported.bytes);
    expect(preview.counts.divergentPreserved).toEqual({
      'lookup-record': 1,
      'learning-item': 1,
      encounter: 1,
    });
    expect(preview.collisions).toHaveLength(3);
    const report = await importer.commitImport(preview.stageId);

    const lookups = (
      target.values.lookupRecordsV1 as { records: Array<{ id: string }> }
    ).records;
    const learning = target.values.learningStateV1 as {
      learningItems: Array<{ id: string; expression: string }>;
      encounters: Array<{
        id: string;
        learningItemId: string;
        lookupRecordId: string;
      }>;
    };
    expect(lookups).toHaveLength(2);
    expect(learning.learningItems).toHaveLength(2);
    expect(learning.encounters).toHaveLength(2);
    const importedLearning = learning.learningItems.find(
      (item) => item.expression === 'postpone imported',
    );
    expect(importedLearning?.id).not.toBe('learning-shared');
    const importedEncounter = learning.encounters.find(
      (encounter) => encounter.id !== 'encounter-shared',
    );
    expect(importedEncounter).toMatchObject({
      learningItemId: importedLearning?.id,
      lookupRecordId: lookups.find((lookup) => lookup.id !== 'lookup-shared')?.id,
    });
    const firstCollision = report.collisions[0];
    if (firstCollision === undefined) throw new Error('Expected a collision');
    const acknowledged = await importer.acknowledgeKeepBoth(
      report.id,
      firstCollision.id,
    );
    expect(acknowledged.collisions[0]?.acknowledged).toBe(true);
    const reports = await importer.listImportReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ id: report.id });
    expect(reports[0]?.collisions[0]?.acknowledged).toBe(true);
    expect(lookups).toHaveLength(2);
    expect(learning.learningItems).toHaveLength(2);

    const repeatPreview = await importer.stageImport(exported.bytes);
    expect(repeatPreview.counts).toEqual({
      added: {},
      identicalSkipped: {
        'lookup-record': 1,
        'learning-item': 1,
        encounter: 1,
      },
      divergentPreserved: {},
    });
    expect(repeatPreview.collisions).toEqual([]);
    await importer.commitImport(repeatPreview.stageId);
    expect(
      (target.values.lookupRecordsV1 as { records: unknown[] }).records,
    ).toHaveLength(2);
    expect(
      (target.values.learningStateV1 as { learningItems: unknown[] })
        .learningItems,
    ).toHaveLength(2);
  });

  it('rejects malformed, future, duplicate, oversized, and quota-exceeding inputs without changing learner state', async () => {
    const target = memoryStorage({
      lookupRecordsV1: emptyRecords,
      learningStateV1: emptyLearning,
      openAiApiKey: 'sk-unchanged',
    });
    const importer = createPortableBackupStore(target, {
      id: (kind) => `${kind}-validation`,
      now: () => '2026-08-16T03:00:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });
    const before = structuredClone(target.values);


    await expect(importer.stageImport(new Uint8Array([0xff]))).rejects.toMatchObject({
      code: 'invalid-utf8',
    });
    await expect(
      importer.stageImport(new TextEncoder().encode('{bad json')),
    ).rejects.toMatchObject({ code: 'malformed' });
    const valid = await createPortableBackupStore(memoryStorage(), {
      id: () => 'validation-source',
      now: () => '2026-08-16T03:00:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    }).exportBackup();
    const future = JSON.parse(new TextDecoder().decode(valid.bytes));
    future.version = 2;
    await expect(
      importer.stageImport(
        new TextEncoder().encode(JSON.stringify(future)),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-version' });
    const unknownKey = JSON.parse(new TextDecoder().decode(valid.bytes));
    unknownKey.state.unexpected = true;
    await expect(
      importer.stageImport(
        new TextEncoder().encode(JSON.stringify(unknownKey)),
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
    const unknownSettingKey = JSON.parse(
      new TextDecoder().decode(valid.bytes),
    );
    unknownSettingKey.state.settings.openAi.unexpected = true;
    await expect(
      importer.stageImport(
        new TextEncoder().encode(JSON.stringify(unknownSettingKey)),
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
    const danglingGraph = JSON.parse(new TextDecoder().decode(valid.bytes));
    danglingGraph.state.learnerNotes.records = [
      {
        version: 1,
        id: 'note-with-missing-learning-item',
        learningItemId: 'missing-learning-item',
        content: 'This graph reference must be validated.',
        createdAt: '2026-08-16T03:00:00.000Z',
        updatedAt: '2026-08-16T03:00:00.000Z',
      },
    ];
    await expect(
      importer.stageImport(
        new TextEncoder().encode(JSON.stringify(danglingGraph)),
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
    const unexpectedReviewKey = JSON.parse(
      new TextDecoder().decode(valid.bytes),
    );
    unexpectedReviewKey.state.learning.learningItems = [
      {
        version: 1,
        id: 'strict-review-learning-item',
        expression: 'postpone',
        normalizedExpression: 'postpone',
        sensePin: null,
        productiveUseIntent: false,
        createdAt: '2026-08-16T03:00:00.000Z',
        status: 'active',
      },
    ];
    unexpectedReviewKey.state.review.approvedItems.records = [
      {
        version: 1,
        id: 'strict-review-item',
        learningItemId: 'strict-review-learning-item',
        knowledgeDimension: 'contextual-meaning',
        task: {
          type: 'recall',
          prompt: 'What does postpone mean here?',
          contextQuote: 'Please postpone the vote.',
          targetAnswers: ['delay'],
          acceptableAlternativeAnswers: [],
          partialAnswers: [],
          correctiveExplanation: 'Postpone means delay.',
        },
        provenance: {
          approvedAt: '2026-08-16T03:00:00.000Z',
          generation: { model: 'gpt-test', promptVersion: 'review-v1' },
          validatorVersion: 'validator-v1',
          evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
          relevantEvidence: [
            BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0],
          ],
          licenseAndAttribution:
            BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution,
          validation: { outcome: 'approved', reasons: [] },
          unexpected: 'must be rejected',
        },
      },
    ];
    await expect(
      importer.stageImport(
        new TextEncoder().encode(JSON.stringify(unexpectedReviewKey)),
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
    const invalidSession = structuredClone(unexpectedReviewKey);
    delete invalidSession.state.review.approvedItems.records[0].provenance
      .unexpected;
    invalidSession.state.review.sessions.records = [
      {
        version: 1,
        id: 'invalid-session',
        status: 'active',
        startedAt: '2026-08-16T03:00:00.000Z',
        completedAt: null,
        reviewItemIds: ['strict-review-item', 'strict-review-item'],
        currentIndex: 2,
        revealedReviewItemIds: ['foreign-review-item'],
      },
    ];
    await expect(
      importer.stageImport(
        new TextEncoder().encode(JSON.stringify(invalidSession)),
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
    const danglingProvenance = JSON.parse(
      new TextDecoder().decode(valid.bytes),
    );
    danglingProvenance.state.provenance.records = [
      {
        version: 1,
        key: JSON.stringify([
          'lookup-record',
          'missing-record',
          'source-backup',
          'source-record',
        ]),
        recordKind: 'lookup-record',
        recordId: 'missing-record',
        importedFrom: {
          backupId: 'source-backup',
          originalId: 'source-record',
          importedAt: '2026-08-16T03:00:00.000Z',
          sourceFingerprint: `sha256:${'0'.repeat(64)}`,
        },
      },
    ];
    await expect(
      importer.stageImport(
        new TextEncoder().encode(JSON.stringify(danglingProvenance)),
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
    const duplicate = JSON.parse(new TextDecoder().decode(valid.bytes));
    duplicate.state.lookupRecords.records = [
      {
        version: 1,
        id: 'duplicate',
        selection: {
          text: 'postpone',
          context: { before: '', after: '' },
        },
        action: {
          type: 'quick-hint',
          result: {
            simplerExpression: 'delay',
            explanationCue: null,
          },
        },
        completedAt: '2026-08-16T03:00:00.000Z',
        usage: { source: 'cache', attempts: 0, provider: null },
      },
    ];
    duplicate.state.lookupRecords.records.push(
      structuredClone(duplicate.state.lookupRecords.records[0]),
    );
    await expect(
      importer.stageImport(
        new TextEncoder().encode(JSON.stringify(duplicate)),
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
    await expect(
      importer.stageImport(new Uint8Array(25 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ code: 'oversized' });
    const quotaImporter = createPortableBackupStore(target, {
      id: (kind) => `${kind}-quota`,
      now: () => '2026-08-16T03:00:00.000Z',
      quotaBytes: 1,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });
    await expect(quotaImporter.stageImport(valid.bytes)).rejects.toMatchObject({
      code: 'quota',
    });
    expect(target.values).toEqual(before);
  });

  it('leaves learner state unchanged when writing the validated stage is interrupted', async () => {
    const bytes = (
      await createPortableBackupStore(memoryStorage(), {
        id: () => 'stage-write-source',
        now: () => '2026-08-16T03:30:00.000Z',
        quotaBytes: 10 * 1024 * 1024,
        bundledEvidencePackVersion: '2025.1.0-minimal.3',
      }).exportBackup()
    ).bytes;
    const target = memoryStorage({
      lookupRecordsV1: emptyRecords,
      openAiApiKey: 'sk-stage-write',
    });
    const before = structuredClone(target.values);
    target.set = async () => {
      throw new Error('simulated stage storage failure');
    };
    const importer = createPortableBackupStore(target, {
      id: (kind) => `${kind}-stage-write`,
      now: () => '2026-08-16T03:30:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });

    await expect(importer.stageImport(bytes)).rejects.toThrow(
      'simulated stage storage failure',
    );
    expect(target.values).toEqual(before);
  });


  it('rejects a stale staged import instead of overwriting learner changes made during confirmation', async () => {
    const source = memoryStorage({
      lookupRecordsV1: {
        version: 1,
        records: [
          {
            version: 1,
            id: 'imported-after-preview',
            selection: {
              text: 'imported',
              context: { before: '', after: ' after preview' },
            },
            action: {
              type: 'quick-hint',
              result: {
                simplerExpression: 'brought in',
                explanationCue: null,
              },
            },
            completedAt: '2026-08-16T03:45:00.000Z',
            usage: { source: 'cache', attempts: 0, provider: null },
          },
        ],
      },
    });
    const bytes = (
      await createPortableBackupStore(source, {
        id: () => 'stale-source',
        now: () => '2026-08-16T03:45:00.000Z',
        quotaBytes: 10 * 1024 * 1024,
        bundledEvidencePackVersion: '2025.1.0-minimal.3',
      }).exportBackup()
    ).bytes;
    const target = memoryStorage({
      lookupRecordsV1: emptyRecords,
    });
    const importer = createPortableBackupStore(target, {
      id: (kind) => `${kind}-stale`,
      now: () => '2026-08-16T03:45:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });
    const preview = await importer.stageImport(bytes);
    const localLookup = {
      version: 1,
      id: 'created-during-confirmation',
      selection: {
        text: 'local',
        context: { before: 'created ', after: ' while reviewing' },
      },
      action: {
        type: 'quick-hint',
        result: { simplerExpression: 'nearby', explanationCue: null },
      },
      completedAt: '2026-08-16T03:46:00.000Z',
      usage: { source: 'cache', attempts: 0, provider: null },
    };
    target.values.lookupRecordsV1 = {
      version: 1,
      records: [localLookup],
    };

    await expect(importer.commitImport(preview.stageId)).rejects.toMatchObject({
      code: 'stale-stage',
    });
    expect(target.values.lookupRecordsV1).toEqual({
      version: 1,
      records: [localLookup],
    });
    expect(target.values.importReportsV1).toBeUndefined();
  });
  it('leaves all current state unchanged when the atomic commit write fails and can retry the same stage', async () => {
    const source = memoryStorage({
      lookupRecordsV1: {
        version: 1,
        records: [
          {
            version: 1,
            id: 'lookup-atomic',
            selection: {
              text: 'postpone',
              context: { before: '', after: '' },
            },
            action: {
              type: 'quick-hint',
              result: {
                simplerExpression: 'delay',
                explanationCue: null,
              },
            },
            completedAt: '2026-08-16T03:00:00.000Z',
            usage: { source: 'cache', attempts: 0, provider: null },
          },
        ],
      },
    });
    const bytes = (
      await createPortableBackupStore(source, {
        id: () => 'atomic-source',
        now: () => '2026-08-16T03:00:00.000Z',
        quotaBytes: 10 * 1024 * 1024,
        bundledEvidencePackVersion: '2025.1.0-minimal.3',
      }).exportBackup()
    ).bytes;
    const target = memoryStorage({
      lookupRecordsV1: emptyRecords,
      learningStateV1: emptyLearning,
      openAiApiKey: 'sk-atomic',
    });
    const originalSet = target.set.bind(target);
    let failCommit = false;
    target.set = async (items) => {
      if (failCommit && 'lookupRecordsV1' in items) {
        throw new Error('simulated atomic storage failure');
      }
      await originalSet(items);
    };
    const importer = createPortableBackupStore(target, {
      id: (kind) => `${kind}-atomic`,
      now: () => '2026-08-16T04:00:00.000Z',
      quotaBytes: 10 * 1024 * 1024,
      bundledEvidencePackVersion: '2025.1.0-minimal.3',
    });
    const preview = await importer.stageImport(bytes);
    const afterStage = structuredClone(target.values);

    failCommit = true;
    await expect(importer.commitImport(preview.stageId)).rejects.toThrow(
      'simulated atomic storage failure',
    );
    expect(target.values).toEqual(afterStage);
    expect(target.values.importReportsV1).toBeUndefined();

    failCommit = false;
    await expect(importer.commitImport(preview.stageId)).resolves.toMatchObject({
      status: 'committed',
    });
    expect(
      (target.values.lookupRecordsV1 as { records: unknown[] }).records,
    ).toHaveLength(1);
    expect(target.values.openAiApiKey).toBe('sk-atomic');
  });
});
