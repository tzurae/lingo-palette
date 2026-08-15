import { describe, expect, it } from 'vitest';
import { createSpeechCache } from './speech-cache';

function memoryStorage(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key: string) {
      return { [key]: values[key] };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, structuredClone(items));
    },
  };
}

describe('Pronunciation speech cache', () => {
  it('recovers exact audio locally across cache instances', async () => {
    const storage = memoryStorage();
    const first = createSpeechCache(storage, () => '2026-08-14T10:00:00.000Z');
    await first.put('model/voice/en-US/Hello', {
      audioBase64: 'AQID',
      mimeType: 'audio/mpeg',
      source: 'provider',
    });

    const reloaded = createSpeechCache(storage, () => '2026-08-14T11:00:00.000Z');
    await expect(reloaded.get('model/voice/en-US/Hello')).resolves.toEqual({
      audioBase64: 'AQID',
      mimeType: 'audio/mpeg',
      source: 'cache',
    });
    await expect(reloaded.get('model/voice/en-GB/Hello')).resolves.toBeNull();
  });
});
