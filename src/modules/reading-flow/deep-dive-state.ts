import { z } from 'zod';
import { parseDeepDive, type DeepDiveResult } from './deep-dive';
import type { Selection } from './selection';
import { selectionSchema } from './selection-parser';

export const DEEP_DIVE_STATE_STORAGE_KEY = 'deepDiveStateV1';

const currentSchema = z.object({
  selection: selectionSchema,
  result: z.unknown(),
  completedAt: z.string().datetime(),
});
const requestSchema = z.object({
  id: z.string().min(1),
  selection: selectionSchema,
  status: z.enum(['working', 'failed', 'cancelled']),
  message: z.string(),
  requestedAt: z.string().datetime(),
  sourceUrl: z.string().url().optional(),
});
const storedStateSchema = z.object({
  version: z.literal(1),
  current: currentSchema.nullable(),
  request: requestSchema.nullable(),
});

export type DeepDiveCurrent = {
  selection: Selection;
  result: DeepDiveResult;
  completedAt: string;
};
export type DeepDiveRequestState = {
  id: string;
  selection: Selection;
  status: 'working' | 'failed' | 'cancelled';
  message: string;
  requestedAt: string;
  sourceUrl?: string;
};
export type DeepDiveState = {
  current: DeepDiveCurrent | null;
  request: DeepDiveRequestState | null;
};
export type DeepDiveStateStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
export type DeepDiveStateCommit = (
  items: Record<string, unknown>,
) => Promise<void>;
export type DeepDiveOutcome =
  | { status: 'completed'; result: DeepDiveResult }
  | { status: 'failed' | 'cancelled'; message: string };

const emptyState = (): DeepDiveState => ({ current: null, request: null });

export function createDeepDiveStateStore(
  storage: DeepDiveStateStorage,
  dependencies: {
    id?: () => string;
    now?: () => string;
  } = {},
): {
  load(): Promise<DeepDiveState>;
  begin(selection: Selection, sourceUrl?: string): Promise<DeepDiveRequestState>;
  settle(
    requestId: string,
    outcome: DeepDiveOutcome,
    commit?: DeepDiveStateCommit,
  ): Promise<DeepDiveState>;
  cancel(requestId: string, message: string): Promise<DeepDiveState>;
  interruptRunning(): Promise<DeepDiveState>;
} {
  const id = dependencies.id ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date().toISOString());
  let pending = Promise.resolve();
  const cancelledRequestIds = new Set<string>();

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

  const loadUnsafe = async (): Promise<DeepDiveState> => {
    const stored = await storage.get(DEEP_DIVE_STATE_STORAGE_KEY);
    const parsed = storedStateSchema.safeParse(
      stored[DEEP_DIVE_STATE_STORAGE_KEY],
    );
    if (!parsed.success) return emptyState();
    try {
      return {
        current:
          parsed.data.current === null
            ? null
            : {
                ...parsed.data.current,
                result: parseDeepDive(parsed.data.current.result),
              },
        request:
          parsed.data.request === null
            ? null
            : (() => {
                const { sourceUrl, ...request } = parsed.data.request;
                return {
                  ...request,
                  ...(sourceUrl === undefined ? {} : { sourceUrl }),
                };
              })(),
      };
    } catch {
      return emptyState();
    }
  };

  const save = async (
    state: DeepDiveState,
    commit?: DeepDiveStateCommit,
  ): Promise<void> => {
    const items = {
      [DEEP_DIVE_STATE_STORAGE_KEY]: { version: 1, ...state },
    };
    if (commit === undefined) {
      await storage.set(items);
    } else {
      await commit(items);
    }
  };

  return {
    async load() {
      return serialized(loadUnsafe);
    },

    async begin(selection, sourceUrl) {
      return serialized(async () => {
        const state = await loadUnsafe();
        const request: DeepDiveRequestState = {
          id: id(),
          selection: selectionSchema.parse(selection),
          status: 'working',
          message: '正在產生 Deep Dive…',
          requestedAt: now(),
          ...(sourceUrl === undefined ? {} : { sourceUrl }),
        };
        await save({ ...state, request });
        return request;
      });
    },

    async settle(requestId, outcome, commit) {
      return serialized(async () => {
        const state = await loadUnsafe();
        if (
          state.request?.id !== requestId ||
          state.request.status !== 'working'
        ) {
          return state;
        }
        if (
          outcome.status === 'completed' &&
          cancelledRequestIds.has(requestId)
        ) {
          return state;
        }
        if (outcome.status === 'completed') {
          const next: DeepDiveState = {
            current: {
              selection: state.request.selection,
              result: parseDeepDive(outcome.result),
              completedAt: now(),
            },
            request: null,
          };
          await save(next, commit);
          return next;
        }
        const next: DeepDiveState = {
          ...state,
          request: {
            ...state.request,
            status: outcome.status,
            message: outcome.message,
          },
        };
        await save(next);
        return next;
      });
    },

    cancel(requestId, message) {
      cancelledRequestIds.add(requestId);
      return serialized(async () => {
        const state = await loadUnsafe();
        if (
          state.request?.id !== requestId ||
          state.request.status !== 'working'
        ) {
          cancelledRequestIds.delete(requestId);
          return state;
        }
        const next: DeepDiveState = {
          ...state,
          request: {
            ...state.request,
            status: 'cancelled',
            message,
          },
        };
        await save(next);
        cancelledRequestIds.delete(requestId);
        return next;
      });
    },

    async interruptRunning() {
      return serialized(async () => {
        const state = await loadUnsafe();
        if (state.request?.status !== 'working') return state;
        const next: DeepDiveState = {
          ...state,
          request: {
            ...state.request,
            status: 'failed',
            message:
              'Deep Dive 因 extension background 中斷；Selection 已保留，可明確重試。',
          },
        };
        await save(next);
        return next;
      });
    },
  };
}
