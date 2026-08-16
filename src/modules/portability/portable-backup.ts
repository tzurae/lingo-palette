import { z } from 'zod';
import {
  DEFAULT_DAILY_BUDGET,
  OPENAI_BUDGET_SETTINGS_STORAGE_KEY,
  validateDailyBudget,
} from '../openai/budget-ledger';
import {
  DEFAULT_OPENAI_CONFIGURATION,
  OPENAI_CONFIGURATION_STORAGE_KEY,
  validateOpenAiConfiguration,
} from '../openai/configuration-store';
import { EVIDENCE_PACK_STATE_STORAGE_KEY } from '../evidence/evidence-pack-browser-adapters';
import {
  LEARNER_NOTES_STORAGE_KEY,
  parseLearnerNotesState,
} from '../learning/learner-note';
import {
  LEARNING_STATE_STORAGE_KEY,
  parseLearningStateStorage,
} from '../learning/learning-item-store';
import {
  LOOKUP_RECORDS_STORAGE_KEY,
  parseLookupRecordsState,
} from '../learning/lookup-record';
import { parsePortableReviewState } from '../review/review-session-store';
import {
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_EVIDENCE_STORAGE_KEY,
  REVIEW_SCHEDULES_STORAGE_KEY,
  REVIEW_SESSIONS_STORAGE_KEY,
} from '../review/review-storage-keys';

export const PORTABLE_PREFERENCES_STORAGE_KEY = 'portablePreferencesV1';
export const PORTABLE_RECORD_PROVENANCE_STORAGE_KEY =
  'portableRecordProvenanceV1';
export const IMPORT_REPORTS_STORAGE_KEY = 'importReportsV1';
export const IMPORT_STAGING_STORAGE_KEY = 'backupImportStagingV1';
export const MAX_PORTABLE_BACKUP_BYTES = 25 * 1024 * 1024;

export const PORTABLE_BACKUP_WARNING =
  '此 UTF-8 JSON 備份未加密，Selection、Reading Context、Learner Notes 與 Review history 可能包含敏感內容；請自行選擇受保護的儲存位置。';

const portablePreferencesSchema = z
  .object({
    pronunciation: z
      .object({
        preferredVariety: z.enum(['en-US', 'en-GB']).nullable(),
      })
      .strict(),
    interface: z.object({ language: z.literal('zh-Hant') }).strict(),
    evidencePack: z
      .object({ preferredVersion: z.string().min(1) })
      .strict(),
  })
  .strict();
const portableRecordKindSchema = z.enum([
  'lookup-record',
  'learning-item',
  'encounter',
  'merge-suggestion',
  'learning-mutation',
  'learner-note',
  'approved-review-item',
  'review-evidence',
  'review-schedule',
  'review-session',
  'setting',
]);
const portableGraphRecordKindSchema = z.enum([
  'lookup-record',
  'learning-item',
  'encounter',
  'merge-suggestion',
  'learning-mutation',
  'learner-note',
  'approved-review-item',
  'review-evidence',
  'review-schedule',
  'review-session',
]);
const provenanceRecordSchema = z
  .object({
    version: z.literal(1),
    key: z.string().min(1),
    recordKind: portableGraphRecordKindSchema,
    recordId: z.string().min(1),
    importedFrom: z
      .object({
        backupId: z.string().min(1),
        originalId: z.string().min(1),
        importedAt: z.iso.datetime(),
        sourceFingerprint: z
          .string()
          .regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();
const provenanceStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(provenanceRecordSchema),
  })
  .strict();
const backupEnvelopeSchema = z
  .object({
    format: z.literal('lingo-palette-backup'),
    version: z.literal(1),
    backupId: z.string().min(1),
    exportedAt: z.iso.datetime(),
    warning: z.string().min(1),
    state: z
      .object({
        lookupRecords: z.unknown(),
        learning: z.unknown(),
        learnerNotes: z.unknown(),
        review: z.unknown(),
        settings: z
          .object({
            openAi: z.unknown(),
            budget: z.unknown(),
            pronunciation: z.unknown(),
            interface: z.unknown(),
            evidencePack: z.unknown(),
          })
          .strict(),
        provenance: z.unknown(),
      })
      .strict(),
  })
  .strict();

const emptyRecords = () => ({ version: 1 as const, records: [] });
const emptyLearning = () => ({
  version: 1 as const,
  learningItems: [],
  encounters: [],
  mergeSuggestions: [],
  history: [],
});

export type PortableRecordKind = z.infer<typeof portableRecordKindSchema>;
export type PortableIdKind =
  | 'backup'
  | 'stage'
  | 'report'
  | 'record'
  | 'collision';
export type ImportCounts = {
  added: Partial<Record<PortableRecordKind, number>>;
  identicalSkipped: Partial<Record<PortableRecordKind, number>>;
  divergentPreserved: Partial<Record<PortableRecordKind, number>>;
};
export type ImportCollision = {
  id: string;
  recordKind: PortableRecordKind;
  originalId: string;
  importedId: string;
  local: unknown;
  imported: unknown;
  acknowledged: boolean;
};
export type ImportPreview = {
  stageId: string;
  sourceBackupId: string;
  sourceExportedAt: string;
  counts: ImportCounts;
  collisions: ImportCollision[];
};
export type ImportReport = ImportPreview & {
  id: string;
  status: 'committed';
  committedAt: string;
};

export type PortableBackupStorage = {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  getBytesInUse(keys?: string | string[] | null): Promise<number>;
};

export type PortableBackupDependencies = {
  id?: (kind: PortableIdKind) => string;
  now?: () => string;
  quotaBytes: number;
  bundledEvidencePackVersion: string;
};

export type PortableBackupErrorCode =
  | 'oversized'
  | 'invalid-utf8'
  | 'malformed'
  | 'unsupported-version'
  | 'quota'
  | 'stale-stage'
  | 'stage-not-found'
  | 'report-not-found';

export class PortableBackupError extends Error {
  constructor(
    readonly code: PortableBackupErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PortableBackupError';
  }
}

type ParsedPortableState = ReturnType<typeof parsePortableState>;
type StagedImport = {
  version: 1;
  id: string;
  preview: ImportPreview;
  baseFingerprint: string;
  commitItems: Record<string, unknown>;
};

const stagingStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(
      z
        .object({
          version: z.literal(1),
          id: z.string().min(1),
          baseFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
          preview: z.unknown(),
          commitItems: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
  })
  .strict();
const reportStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(z.unknown()),
  })
  .strict();

export function createPortableBackupStore(
  storage: PortableBackupStorage,
  dependencies: PortableBackupDependencies,
): {
  exportBackup(): Promise<{
    filename: string;
    bytes: Uint8Array;
    warning: string;
  }>;
  stageImport(bytes: Uint8Array): Promise<ImportPreview>;
  commitImport(stageId: string): Promise<ImportReport>;
  acknowledgeKeepBoth(
    reportId: string,
    collisionId: string,
  ): Promise<ImportReport>;
  listImportReports(): Promise<ImportReport[]>;
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

  return {
    exportBackup: () => serialized(async () => exportBackup(storage, dependencies, id, now)),
    stageImport: (bytes) =>
      serialized(async () => {
        const document = parseBackupBytes(bytes);
        const imported = parsePortableState(document.state);
        const stored = await storage.get(null);
        const local = parseLocalPortableState(stored, dependencies);
        const prepared = await prepareImport({
          imported,
          local,
          stored,
          backupId: document.backupId,
          importedAt: now(),
          id,
        });
        const stageId = id('stage');
        const preview: ImportPreview = {
          stageId,
          sourceBackupId: document.backupId,
          sourceExportedAt: document.exportedAt,
          counts: prepared.counts,
          collisions: prepared.collisions,
        };
        const currentStaging = loadStaging(stored[IMPORT_STAGING_STORAGE_KEY]);
        const staged: StagedImport = {
          version: 1,
          id: stageId,
          preview,
          baseFingerprint: await sourceFingerprint(local),
          commitItems: prepared.commitItems,
        };
        const nextStaging = {
          version: 1 as const,
          records: [...currentStaging, staged],
        };
        const currentBytes = await storage.getBytesInUse(null);
        const stagingBytes = new TextEncoder().encode(
          JSON.stringify(nextStaging),
        ).byteLength;
        if (currentBytes + stagingBytes > dependencies.quotaBytes) {
          throw new PortableBackupError(
            'quota',
            '備份 staging 需要的空間超過目前 extension storage quota；既有資料未變更。',
          );
        }
        await storage.set({ [IMPORT_STAGING_STORAGE_KEY]: nextStaging });
        return preview;
      }),
    commitImport: (stageId) =>
      serialized(async () => {
        const stored = await storage.get(null);
        const stages = loadStaging(stored[IMPORT_STAGING_STORAGE_KEY]);
        const stage = stages.find((candidate) => candidate.id === stageId);
        if (stage === undefined) {
          throw new PortableBackupError(
            'stage-not-found',
            '找不到待提交的 backup import；請重新選擇檔案。',
          );
        }
        const current = parseLocalPortableState(stored, dependencies);
        if ((await sourceFingerprint(current)) !== stage.baseFingerprint) {
          throw new PortableBackupError(
            'stale-stage',
            'Learner state 在確認期間已變更；為避免覆寫新資料，請重新選擇備份並檢查。',
          );
        }
        const report: ImportReport = {
          ...stage.preview,
          id: id('report'),
          status: 'committed',
          committedAt: now(),
        };
        const reports = loadReports(stored[IMPORT_REPORTS_STORAGE_KEY]);
        await storage.set({
          ...stage.commitItems,
          [IMPORT_REPORTS_STORAGE_KEY]: {
            version: 1,
            records: [...reports, report],
          },
          [IMPORT_STAGING_STORAGE_KEY]: {
            version: 1,
            records: stages.filter((candidate) => candidate.id !== stageId),
          },
        });
        return report;
      }),
    acknowledgeKeepBoth: (reportId, collisionId) =>
      serialized(async () => {
        const stored = await storage.get(IMPORT_REPORTS_STORAGE_KEY);
        const reports = loadReports(stored[IMPORT_REPORTS_STORAGE_KEY]);
        const reportIndex = reports.findIndex(
          (candidate) => candidate.id === reportId,
        );
        if (reportIndex < 0) {
          throw new PortableBackupError(
            'report-not-found',
            '找不到指定的 Import Report。',
          );
        }
        const report = reports[reportIndex];
        if (report === undefined) {
          throw new PortableBackupError(
            'report-not-found',
            '找不到指定的 Import Report。',
          );
        }
        const collisionIndex = report.collisions.findIndex(
          (candidate) => candidate.id === collisionId,
        );
        if (collisionIndex < 0) {
          throw new PortableBackupError(
            'report-not-found',
            '找不到指定的 divergent record。',
          );
        }
        const nextReport: ImportReport = {
          ...report,
          collisions: report.collisions.map((collision, index) =>
            index === collisionIndex
              ? { ...collision, acknowledged: true }
              : collision,
          ),
        };
        const nextReports = reports.with(reportIndex, nextReport);
        await storage.set({
          [IMPORT_REPORTS_STORAGE_KEY]: {
            version: 1,
            records: nextReports,
          },
        });
        return nextReport;
      }),
    listImportReports: () =>
      serialized(async () => {
        const stored = await storage.get(IMPORT_REPORTS_STORAGE_KEY);
        return loadReports(stored[IMPORT_REPORTS_STORAGE_KEY]);
      }),
  };
}

async function exportBackup(
  storage: PortableBackupStorage,
  dependencies: PortableBackupDependencies,
  id: (kind: PortableIdKind) => string,
  now: () => string,
): Promise<{ filename: string; bytes: Uint8Array; warning: string }> {
  const stored = await storage.get(portableStorageKeys);
  const exportedAt = now();
  const state = parseLocalPortableState(stored, dependencies);
  const document = {
    format: 'lingo-palette-backup' as const,
    version: 1 as const,
    backupId: id('backup'),
    exportedAt,
    warning: PORTABLE_BACKUP_WARNING,
    state,
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
  return {
    filename: `lingo-palette-backup-${exportedAt.replace(/[:.]/g, '-')}.json`,
    bytes,
    warning: PORTABLE_BACKUP_WARNING,
  };
}

function parseBackupBytes(bytes: Uint8Array): z.infer<typeof backupEnvelopeSchema> {
  if (bytes.byteLength > MAX_PORTABLE_BACKUP_BYTES) {
    throw new PortableBackupError(
      'oversized',
      `備份超過 ${MAX_PORTABLE_BACKUP_BYTES.toLocaleString('en-US')} bytes 上限；尚未解析。`,
    );
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new PortableBackupError('invalid-utf8', '備份不是有效的 UTF-8。', {
      cause: error,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new PortableBackupError('malformed', '備份不是有效的 JSON。', {
      cause: error,
    });
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'version' in raw &&
    raw.version !== 1
  ) {
    throw new PortableBackupError(
      'unsupported-version',
      '此備份版本尚不受目前的 Lingo Palette 支援。',
    );
  }
  try {
    return backupEnvelopeSchema.parse(raw);
  } catch (error) {
    throw new PortableBackupError('malformed', '備份結構或欄位無效。', {
      cause: error,
    });
  }
}

function parsePortableState(value: z.infer<typeof backupEnvelopeSchema>['state']) {
  try {
    const settings = portablePreferencesSchema.parse({
      pronunciation: value.settings.pronunciation,
      interface: value.settings.interface,
      evidencePack: value.settings.evidencePack,
    });
    return {
      lookupRecords: parseLookupRecordsState(value.lookupRecords),
      learning: parseLearningStateStorage(value.learning),
      learnerNotes: parseLearnerNotesState(value.learnerNotes),
      review: parsePortableReviewState(value.review),
      settings: {
        openAi: validateOpenAiConfiguration(value.settings.openAi),
        budget: validateDailyBudget(value.settings.budget),
        ...settings,
      },
      provenance: provenanceStateSchema.parse(value.provenance),
    };
  } catch (error) {
    throw new PortableBackupError('malformed', '備份中的 portable state 無效。', {
      cause: error,
    });
  }
}

function parseLocalPortableState(
  stored: Record<string, unknown>,
  dependencies: PortableBackupDependencies,
): ParsedPortableState {
  const evidenceState = stored[EVIDENCE_PACK_STATE_STORAGE_KEY] as
    | { activeVersion?: unknown }
    | undefined;
  const storedPreferences = stored[PORTABLE_PREFERENCES_STORAGE_KEY];
  const preferences =
    storedPreferences === undefined
      ? {
          pronunciation: { preferredVariety: null },
          interface: { language: 'zh-Hant' as const },
          evidencePack: {
            preferredVersion:
              typeof evidenceState?.activeVersion === 'string'
                ? evidenceState.activeVersion
                : dependencies.bundledEvidencePackVersion,
          },
        }
      : portablePreferencesSchema.parse(storedPreferences);
  return {
    lookupRecords:
      stored[LOOKUP_RECORDS_STORAGE_KEY] === undefined
        ? emptyRecords()
        : parseLookupRecordsState(stored[LOOKUP_RECORDS_STORAGE_KEY]),
    learning:
      stored[LEARNING_STATE_STORAGE_KEY] === undefined
        ? emptyLearning()
        : parseLearningStateStorage(stored[LEARNING_STATE_STORAGE_KEY]),
    learnerNotes:
      stored[LEARNER_NOTES_STORAGE_KEY] === undefined
        ? emptyRecords()
        : parseLearnerNotesState(stored[LEARNER_NOTES_STORAGE_KEY]),
    review: parsePortableReviewState({
      approvedItems:
        stored[APPROVED_REVIEW_ITEMS_STORAGE_KEY] ?? emptyRecords(),
      evidence: stored[REVIEW_EVIDENCE_STORAGE_KEY] ?? emptyRecords(),
      schedules: stored[REVIEW_SCHEDULES_STORAGE_KEY] ?? emptyRecords(),
      sessions: stored[REVIEW_SESSIONS_STORAGE_KEY] ?? emptyRecords(),
    }),
    settings: {
      openAi: validateOpenAiConfiguration(
        stored[OPENAI_CONFIGURATION_STORAGE_KEY] ?? DEFAULT_OPENAI_CONFIGURATION,
      ),
      budget: validateDailyBudget(
        stored[OPENAI_BUDGET_SETTINGS_STORAGE_KEY] ?? DEFAULT_DAILY_BUDGET,
      ),
      ...preferences,
    },
    provenance:
      stored[PORTABLE_RECORD_PROVENANCE_STORAGE_KEY] === undefined
        ? emptyRecords()
        : provenanceStateSchema.parse(
            stored[PORTABLE_RECORD_PROVENANCE_STORAGE_KEY],
          ),
  };
}

type JsonRecord = Record<string, unknown>;
type GraphReference = { kind: PortableRecordKind; id: string };
type GraphNode = {
  kind: Exclude<PortableRecordKind, 'setting'>;
  id: string;
  record: JsonRecord;
  references: GraphReference[];
  hasStableId: boolean;
};

async function prepareImport(input: {
  imported: ParsedPortableState;
  local: ParsedPortableState;
  stored: Record<string, unknown>;
  backupId: string;
  importedAt: string;
  id: (kind: PortableIdKind) => string;
}): Promise<{
  commitItems: Record<string, unknown>;
  counts: ImportCounts;
  collisions: ImportCollision[];
}> {
  const counts: ImportCounts = {
    added: {},
    identicalSkipped: {},
    divergentPreserved: {},
  };
  const collisions: ImportCollision[] = [];
  const importedNodes = collectGraphNodes(input.imported);
  const localNodes = new Map(
    collectGraphNodes(input.local).map((node) => [nodeKey(node.kind, node.id), node]),
  );
  const importedByKey = new Map(
    importedNodes.map((node) => [nodeKey(node.kind, node.id), node]),
  );
  const importedFingerprints = new Map(
    await Promise.all(
      importedNodes.map(async (node) =>
        [
          nodeKey(node.kind, node.id),
          await sourceFingerprint(node.record),
        ] as const,
      ),
    ),
  );
  const adjacency = new Map<string, Set<string>>();
  for (const node of importedNodes) {
    const key = nodeKey(node.kind, node.id);
    adjacency.set(key, adjacency.get(key) ?? new Set());
    for (const reference of node.references) {
      const referenceKey = nodeKey(reference.kind, reference.id);
      if (!importedByKey.has(referenceKey)) {
        throw new PortableBackupError(
          'malformed',
          `備份 graph 缺少 ${reference.kind} ${reference.id}。`,
        );
      }
      adjacency.get(key)?.add(referenceKey);
      const reverse = adjacency.get(referenceKey) ?? new Set<string>();
      reverse.add(key);
      adjacency.set(referenceKey, reverse);
    }
  }

  const provenanceByOriginal = new Map<
    string,
    Array<(typeof input.local.provenance.records)[number]>
  >();
  for (const provenance of input.local.provenance.records) {
    const key = provenanceSourceKey(
      provenance.importedFrom.backupId,
      provenance.recordKind,
      provenance.importedFrom.originalId,
    );
    const matches = provenanceByOriginal.get(key) ?? [];
    matches.push(provenance);
    provenanceByOriginal.set(key, matches);
  }
  const repeated = new Set<string>();
  const provenanceMismatch = new Set<string>();
  for (const node of importedNodes) {
    const key = nodeKey(node.kind, node.id);
    const matches =
      provenanceByOriginal.get(
        provenanceSourceKey(input.backupId, node.kind, node.id),
      ) ?? [];
    const fingerprint = importedFingerprints.get(key);
    if (
      matches.some(
        (provenance) =>
          provenance.importedFrom.sourceFingerprint === fingerprint &&
          localNodes.has(nodeKey(node.kind, provenance.recordId)),
      )
    ) {
      repeated.add(key);
    } else if (matches.length > 0) {
      provenanceMismatch.add(key);
    }
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  for (const key of importedByKey.keys()) {
    if (visited.has(key)) continue;
    const component: string[] = [];
    const queue = [key];
    visited.add(key);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      component.push(current);
      for (const adjacent of adjacency.get(current) ?? []) {
        if (visited.has(adjacent)) continue;
        visited.add(adjacent);
        queue.push(adjacent);
      }
    }
    components.push(component);
  }
  const idempotent = new Set<string>();
  for (const component of components) {
    if (component.every((key) => repeated.has(key))) {
      for (const key of component) idempotent.add(key);
    }
  }

  const divergentSeeds = new Set<string>(provenanceMismatch);
  for (const node of importedNodes) {
    const key = nodeKey(node.kind, node.id);
    if (idempotent.has(key)) continue;
    const existing = localNodes.get(key);
    if (existing !== undefined && !sameValue(existing.record, node.record)) {
      divergentSeeds.add(key);
    }
  }
  const tainted = new Set<string>();
  const taintQueue = [...divergentSeeds];
  while (taintQueue.length > 0) {
    const key = taintQueue.shift();
    if (key === undefined || tainted.has(key)) continue;
    tainted.add(key);
    for (const adjacent of adjacency.get(key) ?? []) taintQueue.push(adjacent);
  }

  const remappedIds = new Map<string, string>();
  for (const node of importedNodes) {
    const key = nodeKey(node.kind, node.id);
    if (tainted.has(key) && node.hasStableId) {
      remappedIds.set(key, input.id('record'));
    }
  }
  const remap = (kind: PortableRecordKind, originalId: string): string =>
    remappedIds.get(nodeKey(kind, originalId)) ?? originalId;
  const applied: GraphNode[] = [];
  const transformedByKind = new Map<PortableRecordKind, JsonRecord[]>();
  const originalByTransformedKey = new Map<string, GraphNode>();
  for (const node of importedNodes) {
    const key = nodeKey(node.kind, node.id);
    if (idempotent.has(key)) {
      increment(counts.identicalSkipped, node.kind);
      continue;
    }
    const existing = localNodes.get(key);
    if (
      !tainted.has(key) &&
      existing !== undefined &&
      sameValue(existing.record, node.record)
    ) {
      increment(counts.identicalSkipped, node.kind);
      continue;
    }
    const transformed = rewriteGraphRecord(node, remap);
    const transformedId = identityForRecord(node.kind, transformed);
    const transformedNode = {
      ...node,
      id: transformedId,
      record: transformed,
    };
    applied.push(transformedNode);
    originalByTransformedKey.set(
      nodeKey(node.kind, transformedId),
      node,
    );
    const records = transformedByKind.get(node.kind) ?? [];
    records.push(transformed);
    transformedByKind.set(node.kind, records);
    if (tainted.has(key)) {
      increment(counts.divergentPreserved, node.kind);
      if (existing !== undefined && !sameValue(existing.record, node.record)) {
        collisions.push({
          id: input.id('collision'),
          recordKind: node.kind,
          originalId: node.id,
          importedId: transformedId,
          local: existing.record,
          imported: transformed,
          acknowledged: false,
        });
      }
    } else {
      increment(counts.added, node.kind);
    }
  }

  const records = (
    kind: Exclude<PortableRecordKind, 'setting'>,
    local: readonly unknown[],
  ): unknown[] => [...local, ...(transformedByKind.get(kind) ?? [])];
  const commitItems: Record<string, unknown> = {
    [LOOKUP_RECORDS_STORAGE_KEY]: {
      version: 1,
      records: records('lookup-record', input.local.lookupRecords.records),
    },
    [LEARNING_STATE_STORAGE_KEY]: {
      version: 1,
      learningItems: records(
        'learning-item',
        input.local.learning.learningItems,
      ),
      encounters: records('encounter', input.local.learning.encounters),
      mergeSuggestions: records(
        'merge-suggestion',
        input.local.learning.mergeSuggestions,
      ),
      history: records('learning-mutation', input.local.learning.history),
    },
    [LEARNER_NOTES_STORAGE_KEY]: {
      version: 1,
      records: records('learner-note', input.local.learnerNotes.records),
    },
    [APPROVED_REVIEW_ITEMS_STORAGE_KEY]: {
      version: 1,
      records: records(
        'approved-review-item',
        input.local.review.approvedItems.records,
      ),
    },
    [REVIEW_EVIDENCE_STORAGE_KEY]: {
      version: 1,
      records: records(
        'review-evidence',
        input.local.review.evidence.records,
      ),
    },
    [REVIEW_SCHEDULES_STORAGE_KEY]: {
      version: 1,
      records: records(
        'review-schedule',
        input.local.review.schedules.records,
      ),
    },
    [REVIEW_SESSIONS_STORAGE_KEY]: {
      version: 1,
      records: records(
        'review-session',
        input.local.review.sessions.records,
      ),
    },
  };
  const preserveSettingConflict = (
    key: string,
    local: unknown,
    imported: unknown,
  ): void => {
    if (sameValue(local, imported)) return;
    collisions.push({
      id: input.id('collision'),
      recordKind: 'setting',
      originalId: key,
      importedId: `import-report:${key}`,
      local,
      imported,
      acknowledged: false,
    });
  };
  if (input.stored[OPENAI_CONFIGURATION_STORAGE_KEY] === undefined) {
    commitItems[OPENAI_CONFIGURATION_STORAGE_KEY] = input.imported.settings.openAi;
  } else {
    preserveSettingConflict(
      OPENAI_CONFIGURATION_STORAGE_KEY,
      input.local.settings.openAi,
      input.imported.settings.openAi,
    );
  }
  if (input.stored[OPENAI_BUDGET_SETTINGS_STORAGE_KEY] === undefined) {
    commitItems[OPENAI_BUDGET_SETTINGS_STORAGE_KEY] = input.imported.settings.budget;
  } else {
    preserveSettingConflict(
      OPENAI_BUDGET_SETTINGS_STORAGE_KEY,
      input.local.settings.budget,
      input.imported.settings.budget,
    );
  }
  const importedPreferences = {
    pronunciation: input.imported.settings.pronunciation,
    interface: input.imported.settings.interface,
    evidencePack: input.imported.settings.evidencePack,
  };
  if (input.stored[PORTABLE_PREFERENCES_STORAGE_KEY] === undefined) {
    commitItems[PORTABLE_PREFERENCES_STORAGE_KEY] = importedPreferences;
  } else {
    preserveSettingConflict(
      PORTABLE_PREFERENCES_STORAGE_KEY,
      {
        pronunciation: input.local.settings.pronunciation,
        interface: input.local.settings.interface,
        evidencePack: input.local.settings.evidencePack,
      },
      importedPreferences,
    );
  }

  const preservedImportedProvenance = input.imported.provenance.records.map(
    (provenance) => {
      const recordId = remap(
        provenance.recordKind as PortableRecordKind,
        provenance.recordId,
      );
      return {
        ...provenance,
        key: provenanceRecordKey(
          provenance.recordKind,
          recordId,
          provenance.importedFrom.backupId,
          provenance.importedFrom.originalId,
        ),
        recordId,
      };
    },
  );
  const currentProvenance = await Promise.all(
    applied.map(async (node) => {
      const original =
        originalByTransformedKey.get(nodeKey(node.kind, node.id)) ?? node;
      return {
        version: 1 as const,
        key: provenanceRecordKey(
          node.kind,
          node.id,
          input.backupId,
          original.id,
        ),
        recordKind: node.kind,
        recordId: node.id,
        importedFrom: {
          backupId: input.backupId,
          originalId: original.id,
          importedAt: input.importedAt,
          sourceFingerprint:
            importedFingerprints.get(nodeKey(original.kind, original.id)) ??
            (await sourceFingerprint(original.record)),
        },
      };
    }),
  );
  const provenance = [
    ...input.local.provenance.records,
    ...preservedImportedProvenance,
    ...currentProvenance,
  ];
  commitItems[PORTABLE_RECORD_PROVENANCE_STORAGE_KEY] = {
    version: 1,
    records: [
      ...new Map(
        provenance.map((record) => [
          `${record.key}\u0000${record.importedFrom.sourceFingerprint}`,
          record,
        ]),
      ).values(),
    ],
  };
  return { commitItems, counts, collisions };
}

function collectGraphNodes(state: ParsedPortableState): GraphNode[] {
  const nodes: GraphNode[] = [];
  const keys = new Set<string>();
  const add = (
    kind: GraphNode['kind'],
    id: string,
    value: unknown,
    references: GraphReference[] = [],
    hasStableId = true,
  ): void => {
    const key = nodeKey(kind, id);
    if (keys.has(key)) {
      throw new PortableBackupError(
        'malformed',
        `備份含有重複的 ${kind} identity ${id}。`,
      );
    }
    keys.add(key);
    nodes.push({
      kind,
      id,
      record: value as JsonRecord,
      references,
      hasStableId,
    });
  };
  for (const record of state.lookupRecords.records) {
    add('lookup-record', record.id, record);
  }
  for (const record of state.learning.learningItems) {
    add(
      'learning-item',
      record.id,
      record,
      record.status === 'merged'
        ? [
            {
              kind: 'learning-item',
              id: record.mergedIntoLearningItemId,
            },
          ]
        : [],
    );
  }
  for (const record of state.learning.encounters) {
    add('encounter', record.id, record, [
      { kind: 'learning-item', id: record.learningItemId },
      { kind: 'lookup-record', id: record.lookupRecordId },
    ]);
  }
  for (const record of state.learning.mergeSuggestions) {
    const references: GraphReference[] = [
      { kind: 'learning-item', id: record.sourceLearningItemId },
      { kind: 'learning-item', id: record.targetLearningItemId },
    ];
    if ('resolutionMutationId' in record) {
      references.push({
        kind: 'learning-mutation',
        id: record.resolutionMutationId,
      });
    }
    if ('supersededByMutationId' in record) {
      references.push({
        kind: 'learning-mutation',
        id: record.supersededByMutationId,
      });
    }
    add('merge-suggestion', record.id, record, references);
  }
  for (const record of state.learning.history) {
    const references: GraphReference[] = [
      { kind: 'learning-item', id: record.sourceLearningItemId },
      { kind: 'learning-item', id: record.targetLearningItemId },
    ];
    if ('encounterIds' in record) {
      references.push(
        ...record.encounterIds.map((id) => ({ kind: 'encounter' as const, id })),
        ...record.targetEncounterIds.map((id) => ({
          kind: 'encounter' as const,
          id,
        })),
      );
    } else if ('suggestionId' in record) {
      references.push({
        kind: 'merge-suggestion',
        id: record.suggestionId,
      });
    } else {
      references.push(
        { kind: 'encounter', id: record.encounterId },
        ...record.supersededSuggestionIds.map((id) => ({
          kind: 'merge-suggestion' as const,
          id,
        })),
      );
    }
    add('learning-mutation', record.id, record, references);
  }
  for (const record of state.learnerNotes.records) {
    add('learner-note', record.id, record, [
      { kind: 'learning-item', id: record.learningItemId },
    ]);
  }
  for (const record of state.review.approvedItems.records) {
    add('approved-review-item', record.id, record, [
      { kind: 'learning-item', id: record.learningItemId },
    ]);
  }
  for (const record of state.review.evidence.records) {
    add('review-evidence', record.id, record, [
      { kind: 'learning-item', id: record.learningItemId },
      { kind: 'approved-review-item', id: record.reviewItemId },
      { kind: 'review-session', id: record.sessionId },
    ]);
  }
  for (const record of state.review.schedules.records) {
    add(
      'review-schedule',
      scheduleIdentity(record.learningItemId, record.knowledgeDimension),
      record,
      [{ kind: 'learning-item', id: record.learningItemId }],
      false,
    );
  }
  for (const record of state.review.sessions.records) {
    add(
      'review-session',
      record.id,
      record,
      record.reviewItemIds.map((id) => ({
        kind: 'approved-review-item' as const,
        id,
      })),
    );
  }
  const provenanceKeys = new Set<string>();
  const provenanceSources = new Set<string>();
  for (const provenance of state.provenance.records) {
    const targetKey = nodeKey(provenance.recordKind, provenance.recordId);
    if (!keys.has(targetKey)) {
      throw new PortableBackupError(
        'malformed',
        `備份 provenance 指向不存在的 ${provenance.recordKind} ${provenance.recordId}。`,
      );
    }
    const expectedKey = provenanceRecordKey(
      provenance.recordKind,
      provenance.recordId,
      provenance.importedFrom.backupId,
      provenance.importedFrom.originalId,
    );
    if (provenance.key !== expectedKey || provenanceKeys.has(provenance.key)) {
      throw new PortableBackupError(
        'malformed',
        '備份 provenance key 無效或重複。',
      );
    }
    provenanceKeys.add(provenance.key);
    const sourceIdentity = `${provenanceSourceKey(
      provenance.importedFrom.backupId,
      provenance.recordKind,
      provenance.importedFrom.originalId,
    )}\u0000${provenance.importedFrom.sourceFingerprint}`;
    if (provenanceSources.has(sourceIdentity)) {
      throw new PortableBackupError(
        'malformed',
        '備份含有重複的 provenance source identity。',
      );
    }
    provenanceSources.add(sourceIdentity);
  }
  return nodes;
}

function rewriteGraphRecord(
  node: GraphNode,
  remap: (kind: PortableRecordKind, originalId: string) => string,
): JsonRecord {
  const record = structuredClone(node.record);
  const rewrite = (property: string, kind: PortableRecordKind): void => {
    const value = record[property];
    if (typeof value === 'string') record[property] = remap(kind, value);
  };
  const rewriteArray = (property: string, kind: PortableRecordKind): void => {
    const value = record[property];
    if (Array.isArray(value)) {
      record[property] = value.map((entry) =>
        typeof entry === 'string' ? remap(kind, entry) : entry,
      );
    }
  };
  if (node.hasStableId) rewrite('id', node.kind);
  switch (node.kind) {
    case 'lookup-record':
      break;
    case 'learning-item':
      rewrite('mergedIntoLearningItemId', 'learning-item');
      break;
    case 'encounter':
      rewrite('learningItemId', 'learning-item');
      rewrite('lookupRecordId', 'lookup-record');
      break;
    case 'merge-suggestion':
      rewrite('sourceLearningItemId', 'learning-item');
      rewrite('targetLearningItemId', 'learning-item');
      rewrite('resolutionMutationId', 'learning-mutation');
      rewrite('supersededByMutationId', 'learning-mutation');
      break;
    case 'learning-mutation':
      rewrite('sourceLearningItemId', 'learning-item');
      rewrite('targetLearningItemId', 'learning-item');
      rewrite('suggestionId', 'merge-suggestion');
      rewrite('encounterId', 'encounter');
      rewriteArray('encounterIds', 'encounter');
      rewriteArray('targetEncounterIds', 'encounter');
      rewriteArray('supersededSuggestionIds', 'merge-suggestion');
      break;
    case 'learner-note':
    case 'approved-review-item':
    case 'review-schedule':
      rewrite('learningItemId', 'learning-item');
      break;
    case 'review-evidence':
      rewrite('learningItemId', 'learning-item');
      rewrite('reviewItemId', 'approved-review-item');
      rewrite('sessionId', 'review-session');
      break;
    case 'review-session':
      rewriteArray('reviewItemIds', 'approved-review-item');
      rewriteArray('revealedReviewItemIds', 'approved-review-item');
      break;
  }
  return record;
}

function identityForRecord(
  kind: Exclude<PortableRecordKind, 'setting'>,
  record: JsonRecord,
): string {
  if (kind === 'review-schedule') {
    return scheduleIdentity(
      requiredString(record, 'learningItemId'),
      requiredString(record, 'knowledgeDimension'),
    );
  }
  return requiredString(record, 'id');
}

function requiredString(record: JsonRecord, property: string): string {
  const value = record[property];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PortableBackupError(
      'malformed',
      `Portable record 缺少 ${property}。`,
    );
  }
  return value;
}

function scheduleIdentity(
  learningItemId: string,
  knowledgeDimension: string,
): string {
  return `${learningItemId}\u0000${knowledgeDimension}`;
}

function nodeKey(kind: PortableRecordKind, id: string): string {
  return `${kind}\u0000${id}`;
}

function provenanceSourceKey(
  backupId: string,
  recordKind: string,
  originalId: string,
): string {
  return `${backupId}\u0000${recordKind}\u0000${originalId}`;
}

function provenanceRecordKey(
  recordKind: string,
  recordId: string,
  backupId: string,
  originalId: string,
): string {
  return JSON.stringify([recordKind, recordId, backupId, originalId]);
}

async function sourceFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return `sha256:${hex}`;
}

function increment(
  counts: Partial<Record<PortableRecordKind, number>>,
  kind: PortableRecordKind,
): void {
  counts[kind] = (counts[kind] ?? 0) + 1;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function loadStaging(value: unknown): StagedImport[] {
  if (value === undefined) return [];
  const parsed = stagingStateSchema.parse(value);
  return parsed.records.map((record) => ({
    version: 1,
    id: record.id,
    baseFingerprint: record.baseFingerprint,
    preview: record.preview as ImportPreview,
    commitItems: record.commitItems,
  }));
}

function loadReports(value: unknown): ImportReport[] {
  if (value === undefined) return [];
  return reportStateSchema.parse(value).records as ImportReport[];
}

const portableStorageKeys = [
  LOOKUP_RECORDS_STORAGE_KEY,
  LEARNING_STATE_STORAGE_KEY,
  LEARNER_NOTES_STORAGE_KEY,
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_EVIDENCE_STORAGE_KEY,
  REVIEW_SCHEDULES_STORAGE_KEY,
  REVIEW_SESSIONS_STORAGE_KEY,
  OPENAI_CONFIGURATION_STORAGE_KEY,
  OPENAI_BUDGET_SETTINGS_STORAGE_KEY,
  EVIDENCE_PACK_STATE_STORAGE_KEY,
  PORTABLE_PREFERENCES_STORAGE_KEY,
  PORTABLE_RECORD_PROVENANCE_STORAGE_KEY,
];
