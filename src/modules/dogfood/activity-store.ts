import { z } from 'zod';

export const DOGFOOD_ACTIVITY_STORAGE_KEY = 'dogfoodActivityV1';

const activityBaseSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    occurredAt: z.iso.datetime(),
    localDate: z.iso.date(),
  })
  .strict();
const siteActivityBaseSchema = activityBaseSchema.extend({
  origin: z.url(),
});

const dogfoodActivityEventSchema = z.discriminatedUnion('kind', [
  siteActivityBaseSchema.extend({ kind: z.literal('selection') }).strict(),
  siteActivityBaseSchema
    .extend({
      kind: z.literal('pronunciation-playback-completed'),
      variety: z.enum(['en-US', 'en-GB']),
      sentenceCount: z.number().int().positive(),
    })
    .strict(),
  activityBaseSchema
    .extend({
      kind: z.literal('learning-item-saved'),
      learningItemId: z.string().min(1),
      origin: z.url().optional(),
    })
    .strict(),
  activityBaseSchema
    .extend({
      kind: z.literal('review-session-completed'),
      reviewSessionId: z.string().min(1),
    })
    .strict(),
  activityBaseSchema
    .extend({
      kind: z.literal('portable-backup-exported'),
      backupFilename: z.string().min(1),
    })
    .strict(),
  activityBaseSchema
    .extend({
      kind: z.literal('portable-backup-imported'),
      importReportId: z.string().min(1),
    })
    .strict(),
]);

const dogfoodActivityStateSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().min(1),
    enabled: z.boolean(),
    startedAt: z.iso.datetime(),
    startedLocalDate: z.iso.date(),
    events: z.array(dogfoodActivityEventSchema),
  })
  .strict();

export type DogfoodActivityEvent = z.infer<typeof dogfoodActivityEventSchema>;
export type DogfoodActivitySnapshot = z.infer<typeof dogfoodActivityStateSchema>;
export type DogfoodActivityInput =
  | { kind: 'selection'; origin: string }
  | {
      kind: 'pronunciation-playback-completed';
      origin: string;
      variety: 'en-US' | 'en-GB';
      sentenceCount: number;
    }
  | { kind: 'learning-item-saved'; learningItemId: string; origin?: string }
  | { kind: 'review-session-completed'; reviewSessionId: string }
  | { kind: 'portable-backup-exported'; backupFilename: string }
  | { kind: 'portable-backup-imported'; importReportId: string };

export type DogfoodActivityStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type DogfoodClockReading = {
  occurredAt: string;
  localDate: string;
};

export function createDogfoodActivityStore(
  storage: DogfoodActivityStorage,
  dependencies: {
    clock?: () => DogfoodClockReading;
    id?: () => string;
  } = {},
): {
  start(): Promise<DogfoodActivitySnapshot>;
  pause(): Promise<DogfoodActivitySnapshot | null>;
  record(input: DogfoodActivityInput): Promise<DogfoodActivityEvent | null>;
  snapshot(): Promise<DogfoodActivitySnapshot | null>;
} {
  const clock = dependencies.clock ?? currentClockReading;
  const id = dependencies.id ?? (() => crypto.randomUUID());
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

  const load = async (): Promise<DogfoodActivitySnapshot | null> => {
    const stored = await storage.get(DOGFOOD_ACTIVITY_STORAGE_KEY);
    const raw = stored[DOGFOOD_ACTIVITY_STORAGE_KEY];
    if (raw === undefined) return null;
    const parsed = dogfoodActivityStateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        'Stored dogfood activity is invalid; collection was not changed.',
        { cause: parsed.error },
      );
    }
    return parsed.data;
  };

  const save = async (
    state: DogfoodActivitySnapshot,
  ): Promise<DogfoodActivitySnapshot> => {
    const parsed = dogfoodActivityStateSchema.parse(state);
    await storage.set({ [DOGFOOD_ACTIVITY_STORAGE_KEY]: parsed });
    return parsed;
  };

  return {
    start() {
      return serialized(async () => {
        const state = await load();
        if (state !== null) return save({ ...state, enabled: true });
        const started = clock();
        return save({
          version: 1,
          runId: id(),
          enabled: true,
          startedAt: started.occurredAt,
          startedLocalDate: started.localDate,
          events: [],
        });
      });
    },

    pause() {
      return serialized(async () => {
        const state = await load();
        if (state === null || !state.enabled) return state;
        return save({ ...state, enabled: false });
      });
    },

    record(input) {
      return serialized(async () => {
        const state = await load();
        if (state === null || !state.enabled) return null;
        const timestamp = clock();
        const normalizedInput =
          'origin' in input && input.origin !== undefined
            ? { ...input, origin: canonicalOrigin(input.origin) }
            : input;
        const event = dogfoodActivityEventSchema.parse({
          version: 1,
          id: id(),
          ...timestamp,
          ...normalizedInput,
        });
        await save({ ...state, events: [...state.events, event] });
        return event;
      });
    },

    snapshot() {
      return serialized(load);
    },
  };
}

export function parseDogfoodActivitySnapshot(
  value: unknown,
): DogfoodActivitySnapshot {
  return dogfoodActivityStateSchema.parse(value);
}

function canonicalOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Dogfood activity origins must use HTTP(S).');
  }
  return url.origin;
}

function currentClockReading(): DogfoodClockReading {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return {
    occurredAt: date.toISOString(),
    localDate: `${year}-${month}-${day}`,
  };
}

export function countSelectionSentences(value: string): number {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  let count = 0;
  for (const { segment } of segmenter.segment(value)) {
    if (segment.trim().length > 0) count += 1;
  }
  return Math.max(1, count);
}
