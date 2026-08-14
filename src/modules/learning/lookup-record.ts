import { z } from 'zod';
import type { ProviderUsage } from '../openai/budget-ledger';
import { parseDeepDive, type DeepDiveResult } from '../reading-flow/deep-dive';
import {
  parseQuickHint,
  parseQuickHintSelection,
  type QuickHintResult,
} from '../reading-flow/quick-hint';
import type { Selection } from '../reading-flow/selection';

export const LOOKUP_RECORDS_STORAGE_KEY = 'lookupRecordsV1';

const providerUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
  })
  .strict();
const usageSchema = z
  .object({
    source: z.enum(['cache', 'provider']),
    attempts: z.number().int().nonnegative(),
    provider: providerUsageSchema.nullable(),
  })
  .strict();
const actionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('quick-hint'),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal('deep-dive'),
      result: z.unknown(),
    })
    .strict(),
]);
const recordSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    selection: z.unknown(),
    action: actionSchema,
    completedAt: z.string().datetime(),
    usage: usageSchema,
    sourceUrl: z.string().url().optional(),
  })
  .strict();
const storedRecordsSchema = z
  .object({
    version: z.literal(1),
    records: z.array(recordSchema),
  })
  .strict();

export type LookupRecordAction =
  | { type: 'quick-hint'; result: QuickHintResult }
  | { type: 'deep-dive'; result: DeepDiveResult };
export type LookupUsage = {
  source: 'cache' | 'provider';
  attempts: number;
  provider: ProviderUsage | null;
};
export type LookupRecord = {
  version: 1;
  id: string;
  selection: Selection;
  action: LookupRecordAction;
  completedAt: string;
  usage: LookupUsage;
  sourceUrl?: string;
};
export type CompletedLookup = {
  selection: Selection;
  action: LookupRecordAction;
  usage: LookupUsage;
  sourceUrl?: string;
};
export type LookupRecordStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
export type LookupRecordCommit = (
  items: Record<string, unknown>,
) => Promise<void>;

export function createLookupRecordStore(
  storage: LookupRecordStorage,
  dependencies: {
    id?: () => string;
    now?: () => string;
  } = {},
): {
  append(
    lookup: CompletedLookup,
    commit?: LookupRecordCommit,
  ): Promise<LookupRecord>;
  list(): Promise<LookupRecord[]>;
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

  const loadUnsafe = async (): Promise<LookupRecord[]> => {
    const stored = await storage.get(LOOKUP_RECORDS_STORAGE_KEY);
    const raw = stored[LOOKUP_RECORDS_STORAGE_KEY];
    if (raw === undefined) return [];
    const parsed = storedRecordsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error('Stored Lookup Records are invalid; existing data was not changed.');
    }
    try {
      return parsed.data.records.map(parseLookupRecord);
    } catch (error) {
      throw new Error(
        'Stored Lookup Records contain an invalid Selection or Action result; existing data was not changed.',
        { cause: error },
      );
    }
  };

  return {
    async append(lookup, commit) {
      return serialized(async () => {
        const records = await loadUnsafe();
        const sourceUrl = sanitizeSourceUrl(lookup.sourceUrl);
        const record = parseLookupRecord({
          version: 1,
          id: id(),
          selection: lookup.selection,
          action: lookup.action,
          completedAt: now(),
          usage: lookup.usage,
          ...(sourceUrl === undefined ? {} : { sourceUrl }),
        });
        const items = {
          [LOOKUP_RECORDS_STORAGE_KEY]: {
            version: 1,
            records: [record, ...records],
          },
        };
        if (commit === undefined) {
          await storage.set(items);
        } else {
          await commit(items);
        }
        return record;
      });
    },

    async list() {
      return serialized(loadUnsafe);
    },
  };
}

export function sanitizeSourceUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseLookupRecord(value: unknown): LookupRecord {
  const parsed = recordSchema.parse(value);
  const action: LookupRecordAction =
    parsed.action.type === 'quick-hint'
      ? {
          type: 'quick-hint',
          result: parseQuickHint(parsed.action.result),
        }
      : {
          type: 'deep-dive',
          result: parseDeepDive(parsed.action.result),
        };
  const { sourceUrl, selection, ...required } = parsed;
  return {
    ...required,
    selection: parseQuickHintSelection(selection),
    action,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  };
}
