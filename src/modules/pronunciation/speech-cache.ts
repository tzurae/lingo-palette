import { z } from 'zod';
import type { RemoteAudio } from './playback';

export const SPEECH_CACHE_STORAGE_KEY = 'pronunciationSpeechCacheV1';
const maximumEntries = 50;
const maximumEncodedAudioCharacters = 5_000_000;

const cacheSchema = z.object({
  version: z.literal(1),
  entries: z.record(
    z.string(),
    z.object({
      audioBase64: z.string().min(1),
      mimeType: z.literal('audio/mpeg'),
      updatedAt: z.string().datetime(),
    }),
  ),
});

type SpeechCacheState = z.infer<typeof cacheSchema>;

export type SpeechCacheStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type SpeechCache = {
  get(key: string): Promise<RemoteAudio | null>;
  put(key: string, audio: RemoteAudio): Promise<void>;
};

export function createSpeechCache(
  storage: SpeechCacheStorage,
  now: () => string = () => new Date().toISOString(),
): SpeechCache {
  let pending = Promise.resolve();

  const serialized = async <Value>(operation: () => Promise<Value>) => {
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

  const load = async (): Promise<SpeechCacheState> => {
    const stored = await storage.get(SPEECH_CACHE_STORAGE_KEY);
    const parsed = cacheSchema.safeParse(stored[SPEECH_CACHE_STORAGE_KEY]);
    return parsed.success ? parsed.data : { version: 1, entries: {} };
  };

  return {
    async get(key) {
      return serialized(async () => {
        const cached = (await load()).entries[key];
        if (cached === undefined) return null;
        return {
          audioBase64: cached.audioBase64,
          mimeType: cached.mimeType,
          source: 'cache',
        };
      });
    },

    async put(key, audio) {
      await serialized(async () => {
        const state = await load();
        const entries: SpeechCacheState['entries'] = {
          ...state.entries,
          [key]: {
            audioBase64: audio.audioBase64,
            mimeType: 'audio/mpeg',
            updatedAt: now(),
          },
        };
        const retained: SpeechCacheState['entries'] = {};
        let retainedCharacters = 0;
        for (const [entryKey, entry] of Object.entries(entries)
          .sort((left, right) =>
            right[1].updatedAt.localeCompare(left[1].updatedAt),
          )
          .slice(0, maximumEntries)) {
          if (
            retainedCharacters + entry.audioBase64.length >
            maximumEncodedAudioCharacters
          ) {
            continue;
          }
          retained[entryKey] = entry;
          retainedCharacters += entry.audioBase64.length;
        }
        await storage.set({
          [SPEECH_CACHE_STORAGE_KEY]: { version: 1, entries: retained },
        });
      });
    },
  };
}
