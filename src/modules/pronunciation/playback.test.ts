import { describe, expect, it } from 'vitest';
import {
  chunkSelection,
  conservativeTokenCount,
  createPronunciationPlayback,
  discoverExactLocalVoice,
  selectExactLocalVoice,
} from './playback';
import { parsePronunciationSelection } from './selection-parser';

describe('Pronunciation Playback', () => {
  it('selects only a local voice with the exact normalized variety tag', () => {
    const voices = [
      {
        id: 'generic-default-named-us',
        lang: 'en',
        localService: true,
        name: 'US English',
        default: true,
      },
      {
        id: 'remote-us',
        lang: 'en-US',
        localService: false,
        name: 'Remote US',
        default: false,
      },
      {
        id: 'local-uk',
        lang: 'en-GB',
        localService: true,
        name: 'UK English',
        default: false,
      },
      {
        id: 'local-us',
        lang: 'en-us',
        localService: true,
        name: 'Neutral',
        default: false,
      },
    ];

    expect(selectExactLocalVoice(voices, 'en-US')).toEqual(voices[3]);
    expect(selectExactLocalVoice(voices, 'en-GB')).toEqual(voices[2]);
  });

  it('waits for asynchronous browser voice discovery before deciding fallback', async () => {
    const localVoice = {
      id: 'late-local-us',
      lang: 'en-US',
      localService: true,
      name: 'Late US',
      default: false,
    };
    let voices = [
      {
        id: 'generic-initial',
        lang: 'en',
        localService: true,
        name: 'Generic initial voice',
        default: true,
      },
    ];
    let discoveryObserved = false;

    const selected = discoverExactLocalVoice(
      {
        getVoices: () => voices,
        async waitForVoices() {
          discoveryObserved = true;
          voices = [localVoice];
        },
      },
      'en-US',
      new AbortController().signal,
    );

    await expect(selected).resolves.toEqual(localVoice);
    expect(discoveryObserved).toBe(true);
  });

  it('uses a UTF-8 byte upper bound so browser chunks cannot exceed token limits', () => {
    expect(conservativeTokenCount('Aé😊')).toBe(7);
  });

  it('accepts the full provider chunk range independently of assistance limits', () => {
    expect(
      parsePronunciationSelection({
        text: 'a'.repeat(4_095),
        context: { before: '', after: '' },
      }).text,
    ).toHaveLength(4_095);
    expect(() =>
      parsePronunciationSelection({
        text: 'a'.repeat(4_096),
        context: { before: '', after: '' },
      }),
    ).toThrow();
  });

  it('keeps sentence boundaries while every chunk stays below both provider ceilings', () => {
    const firstSentence = `${'A'.repeat(1_500)}. `;
    const secondSentence = `${'B'.repeat(1_000)}.`;
    const text = `${firstSentence}${secondSentence}`;
    const chunks = chunkSelection(
      text,
      (value) => Array.from(value).length,
    );

    expect(chunks).toEqual([firstSentence, secondSentence]);
    expect(chunks.join('')).toBe(text);
    expect(
      chunks.every(
        (chunk) =>
          Array.from(chunk).length < 4_096 &&
          Array.from(chunk).length < 2_000,
      ),
    ).toBe(true);
  });

  it('counts the variety instruction while playing sentence chunks as one queue', async () => {
    const played: string[] = [];
    const firstSentence = `${'A'.repeat(1_000)}. `;
    const secondSentence = `${'B'.repeat(900)}.`;
    const playback = createPronunciationPlayback({
      countTokens: (value) => Array.from(value).length,
      voices: {
        getVoices: () => [
          {
            id: 'local-us',
            lang: 'en-US',
            localService: true,
            name: 'Local US',
            default: false,
          },
        ],
        async waitForVoices() {},
      },
      local: {
        async play(text) {
          played.push(text);
        },
        pause() {},
        resume() {},
        stop() {},
      },
      remote: {
        async load() {
          throw new Error('Remote fallback must not run.');
        },
        async play() {
          throw new Error('Remote playback must not run.');
        },
        async cancel() {},
        pause() {},
        resume() {},
        stop() {},
      },
      id: () => 'pronunciation-1',
    });

    await playback.start(`${firstSentence}${secondSentence}`, 'en-US');

    expect(played).toEqual([firstSentence, secondSentence]);
    expect(playback.getState()).toMatchObject({
      status: 'completed',
      source: 'local',
      currentChunk: 2,
      totalChunks: 2,
    });
  });

  it('queues remote chunks and aggregates their provider usage', async () => {
    const requested: string[] = [];
    const played: string[] = [];
    const firstSentence = `${'A'.repeat(1_000)}. `;
    const secondSentence = `${'B'.repeat(900)}.`;
    const playback = createPronunciationPlayback({
      countTokens: (value) => Array.from(value).length,
      voices: {
        getVoices: () => [
          {
            id: 'generic',
            lang: 'en',
            localService: true,
            name: 'Generic English',
            default: true,
          },
        ],
        async waitForVoices() {},
      },
      local: {
        async play() {
          throw new Error('A generic voice must not establish variety.');
        },
        pause() {},
        resume() {},
        stop() {},
      },
      remote: {
        async load({ text }) {
          requested.push(text);
          return {
            audioBase64: 'AQID',
            mimeType: 'audio/mpeg',
            source: 'provider',
            usage: {
              inputTokens: 1,
              cachedInputTokens: 0,
              outputTokens: 2,
              reasoningTokens: 0,
              totalTokens: 3,
              estimatedCostUsd: 0.000025,
            },
            attempts: 1,
          };
        },
        async play(audio) {
          played.push(audio.audioBase64);
        },
        async cancel() {},
        pause() {},
        resume() {},
        stop() {},
      },
      id: () => 'pronunciation-remote',
    });

    await playback.start(`${firstSentence}${secondSentence}`, 'en-GB');

    expect(requested).toEqual([firstSentence, secondSentence]);
    expect(played).toEqual(['AQID', 'AQID']);
    expect(playback.getState()).toMatchObject({
      status: 'completed',
      source: 'remote',
      currentChunk: 2,
      totalChunks: 2,
      attempts: 2,
      usage: {
        inputTokens: 2,
        outputTokens: 4,
        totalTokens: 6,
        estimatedCostUsd: 0.00005,
      },
    });
  });

  it('does not start remote audio when Stop releases a paused generation gate', async () => {
    const loading = Promise.withResolvers<{
      audioBase64: string;
      mimeType: 'audio/mpeg';
      source: 'provider';
      usage: null;
      attempts: number;
    }>();
    const loadStarted = Promise.withResolvers<void>();
    let playCalls = 0;
    const playback = createPronunciationPlayback({
      countTokens: (value) => Array.from(value).length,
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
        async load() {
          loadStarted.resolve();
          return loading.promise;
        },
        async play() {
          playCalls += 1;
        },
        async cancel() {},
        pause() {},
        resume() {},
        stop() {},
      },
      id: () => 'paused-stop',
    });

    const started = playback.start('postpone', 'en-US');
    await loadStarted.promise;
    const generatingMessage = playback.getState().message;
    playback.reportProgress('stale-request', 'stale progress');
    expect(playback.getState().message).toBe(generatingMessage);
    playback.reportProgress('paused-stop', 'current progress');
    expect(playback.getState().message).toBe('current progress');
    playback.pause();
    loading.resolve({
      audioBase64: 'AQID',
      mimeType: 'audio/mpeg',
      source: 'provider',
      usage: null,
      attempts: 1,
    });
    await Promise.resolve();
    playback.stop();
    await started;

    expect(playCalls).toBe(0);
    expect(playback.getState()).toMatchObject({ status: 'stopped' });
    playback.reset();
    expect(playback.getState()).toMatchObject({
      status: 'idle',
      variety: null,
      currentChunk: 0,
      totalChunks: 0,
    });
  });
});
