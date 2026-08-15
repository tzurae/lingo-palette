import { describe, expect, it } from 'vitest';
import type { ProviderUsage } from '../openai/budget-ledger';
import type { OpenAiConfiguration } from '../openai/configuration-store';
import {
  createPronunciationPlayback,
  type RemoteAudio,
} from './playback';
import {
  createPronunciationExecutor,
  pronunciationCacheKey,
} from './pronunciation-executor';

const configuration: OpenAiConfiguration = {
  model: { kind: 'curated', id: 'gpt-5.4-mini-2026-03-17' },
  efforts: { quickHint: 'low', deepDive: 'medium', review: 'medium' },
  personalInstructions: '',
};

const request = {
  apiKey: '',
  configuration,
  selection: { text: 'Hello there.', context: { before: '', after: '' } },
  variety: 'en-US' as const,
};

const audio: RemoteAudio = {
  audioBase64: 'AQID',
  mimeType: 'audio/mpeg',
  source: 'provider',
};

describe('Pronunciation remote executor', () => {
  it('uses an exact text/variety/voice/model cache hit offline without budget', async () => {
    const values = new Map([[pronunciationCacheKey(request), audio]]);
    const executor = createPronunciationExecutor({
      countTokens: (text) => Array.from(text).length,
      isOnline: () => false,
      cache: {
        async get(key) {
          return values.get(key) ?? null;
        },
        async put(key, value) {
          values.set(key, value);
        },
      },
      budget: {
        async reserve() {
          throw new Error('Cache hit must not reserve budget.');
        },
        async reconcile() {},
        async release() {},
      },
      provider: {
        async generate() {
          throw new Error('Cache hit must not call provider.');
        },
      },
      async wait() {},
      random: () => 0,
    });

    await expect(executor.execute(request)).resolves.toEqual({
      source: 'cache',
      result: audio,
      usage: null,
      attempts: 0,
    });
  });

  it('reserves and reconciles the speech-token cost through the shared budget', async () => {
    const events: string[] = [];
    const usage: ProviderUsage = {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningTokens: 0,
      totalTokens: 30,
      estimatedCostUsd: 0.000246,
    };
    const executor = createPronunciationExecutor({
      countTokens: () => 100,
      isOnline: () => true,
      cache: {
        async get() {
          return null;
        },
        async put() {
          events.push('cache:put');
        },
      },
      budget: {
        async reserve(input) {
          expect(input).toEqual({
            tokens: 32_100,
            estimatedCostUsd: 0.38406,
          });
          events.push('budget:reserve');
          return {
            status: 'reserved',
            reservation: {
              id: 'speech-reservation',
              activeDate: '2026-08-14',
              tokens: input.tokens,
              estimatedCostUsd: input.estimatedCostUsd ?? 0,
            },
          };
        },
        async reconcile(reservation, reported) {
          events.push(`budget:reconcile:${reservation.id}:${reported.totalTokens}`);
        },
        async release() {
          throw new Error('Successful generation must reconcile.');
        },
      },
      provider: {
        async generate(input) {
          expect(input).toMatchObject({
            variety: 'en-US',
            selection: { text: 'Hello there.' },
          });
          events.push('provider:generate');
          return { result: audio, usage };
        },
      },
      async wait() {},
      random: () => 0,
    });

    await expect(
      executor.execute({ ...request, apiKey: 'sk-test' }),
    ).resolves.toMatchObject({
      source: 'provider',
      result: audio,
      usage,
      attempts: 1,
    });
    expect(events).toEqual([
      'budget:reserve',
      'provider:generate',
      'budget:reconcile:speech-reservation:30',
      'cache:put',
    ]);
  });

  it('blocks a later queue chunk before any provider call when its budget is exhausted', async () => {
    let reservations = 0;
    const providerTexts: string[] = [];
    const executor = createPronunciationExecutor({
      countTokens: (text) => Array.from(text).length,
      isOnline: () => true,
      cache: {
        async get() {
          return null;
        },
        async put() {},
      },
      budget: {
        async reserve(input) {
          reservations += 1;
          if (reservations > 1) {
            return { status: 'blocked' as const, kind: 'token-budget' as const };
          }
          return {
            status: 'reserved' as const,
            reservation: {
              id: 'first-chunk',
              activeDate: '2026-08-14',
              tokens: input.tokens,
              estimatedCostUsd: input.estimatedCostUsd ?? 0,
            },
          };
        },
        async reconcile() {},
        async release() {},
      },
      provider: {
        async generate(input) {
          providerTexts.push(input.selection.text);
          return {
            result: audio,
            usage: {
              inputTokens: 10,
              cachedInputTokens: 0,
              outputTokens: 20,
              reasoningTokens: 0,
              totalTokens: 30,
              estimatedCostUsd: 0.000246,
            },
          };
        },
      },
      async wait() {},
      random: () => 0,
    });
    const firstSentence = `${'A'.repeat(1_000)}. `;
    const secondSentence = `${'B'.repeat(900)}.`;
    const playback = createPronunciationPlayback({
      countTokens: (text) => Array.from(text).length,
      voices: {
        getVoices: () => [],
        async waitForVoices() {},
      },
      local: {
        async play() {
          throw new Error('Local playback must not run.');
        },
        pause() {},
        resume() {},
        stop() {},
      },
      remote: {
        async load({ requestId: _requestId, text, variety }, signal) {
          const outcome = await executor.execute(
            {
              ...request,
              apiKey: 'sk-test',
              selection: { text, context: { before: '', after: '' } },
              variety,
            },
            signal,
          );
          return {
            ...outcome.result,
            source: outcome.source,
            usage: outcome.usage,
            attempts: outcome.attempts,
          };
        },
        async play() {},
        async cancel() {},
        pause() {},
        resume() {},
        stop() {},
      },
      id: () => 'budgeted-queue',
    });

    await playback.start(`${firstSentence}${secondSentence}`, 'en-US');

    expect(providerTexts).toEqual([firstSentence]);
    expect(playback.getState()).toMatchObject({
      status: 'failed',
      currentChunk: 2,
      message: expect.stringContaining('token hard limit'),
    });
  });
});
