import { describe, expect, it } from 'vitest';
import { pronunciationInstructions } from './playback';
import { createOpenAiSpeechClient } from './openai-speech';

const sse = [
  'event: speech.audio.delta',
  'data: {"type":"speech.audio.delta","audio":"AQI="}',
  '',
  'event: speech.audio.delta',
  'data: {"type":"speech.audio.delta","audio":"AwQ="}',
  '',
  'event: speech.audio.done',
  'data: {"type":"speech.audio.done","usage":{"input_tokens":14,"output_tokens":999,"total_tokens":1013}}',
  '',
].join('\n');

describe('OpenAI speech client', () => {
  it('requests the fixed cedar snapshot with explicit variety and returns audio usage', async () => {
    let observed: { url: string; init: RequestInit } | null = null;
    const client = createOpenAiSpeechClient(async (url, init) => {
      observed = { url: String(url), init: init ?? {} };
      return new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const generated = await client.generate(
      {
        apiKey: 'sk-test',
        text: 'Hello there.',
        variety: 'en-GB',
      },
      new AbortController().signal,
    );

    expect(observed).not.toBeNull();
    expect(observed!.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(observed!.init.headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(observed!.init.body))).toEqual({
      model: 'gpt-4o-mini-tts-2025-12-15',
      voice: 'cedar',
      input: 'Hello there.',
      instructions: pronunciationInstructions('en-GB'),
      response_format: 'mp3',
      stream_format: 'sse',
    });
    expect(generated.result).toEqual({
      audioBase64: 'AQIDBA==',
      mimeType: 'audio/mpeg',
      source: 'provider',
    });
    expect(generated.usage).toEqual({
      inputTokens: 14,
      cachedInputTokens: 0,
      outputTokens: 999,
      reasoningTokens: 0,
      totalTokens: 1013,
      estimatedCostUsd: 0.0119964,
    });
  });

  it('maps Retry-After rate limits into the shared transient failure contract', async () => {
    const client = createOpenAiSpeechClient(async () =>
      Response.json(
        {
          error: {
            code: 'rate_limit_exceeded',
            message: 'Slow down.',
          },
          usage: {
            input_tokens: 4,
            output_tokens: 8,
            total_tokens: 12,
          },
        },
        { status: 429, headers: { 'Retry-After': '2' } },
      ),
    );

    await expect(
      client.generate(
        { apiKey: 'sk-test', text: 'Hello.', variety: 'en-US' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      providerKind: 'rate-limit',
      retryable: true,
      retryAfterMs: 2_000,
      usage: {
        inputTokens: 4,
        cachedInputTokens: 0,
        outputTokens: 8,
        reasoningTokens: 0,
        totalTokens: 12,
      },
    });
  });

  it('fails explicitly when a completed stream omits accountable usage', async () => {
    const client = createOpenAiSpeechClient(async () =>
      new Response(
        [
          'event: speech.audio.delta',
          'data: {"type":"speech.audio.delta","audio":"AQID"}',
          '',
        ].join('\n'),
        { status: 200 },
      ),
    );

    await expect(
      client.generate(
        { apiKey: 'sk-test', text: 'Hello.', variety: 'en-US' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      providerKind: 'provider-unavailable',
      retryable: false,
      message:
        'OpenAI 語音回應缺少或包含無效的 audio / usage，無法安全播放。',
    });
  });

  it('charges reported usage when a completed stream contains no audio', async () => {
    const client = createOpenAiSpeechClient(async () =>
      new Response(
        'data: {"type":"speech.audio.done","usage":{"input_tokens":4,"output_tokens":8,"total_tokens":12}}\n',
        { status: 200 },
      ),
    );

    await expect(
      client.generate(
        { apiKey: 'sk-test', text: 'Hello.', variety: 'en-US' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      providerKind: 'provider-unavailable',
      retryable: false,
      usage: {
        inputTokens: 4,
        cachedInputTokens: 0,
        outputTokens: 8,
        reasoningTokens: 0,
        totalTokens: 12,
      },
    });
  });

  it('rejects a malformed required audio event instead of caching partial speech', async () => {
    const client = createOpenAiSpeechClient(async () =>
      new Response(
        [
          'data: {"type":"speech.audio.delta","audio":"AQID"}',
          'data: {"type":"speech.audio.delta","audio":42}',
          'data: {"type":"speech.audio.done","usage":{"input_tokens":4,"output_tokens":8,"total_tokens":12}}',
        ].join('\n'),
        { status: 200 },
      ),
    );

    await expect(
      client.generate(
        { apiKey: 'sk-test', text: 'Hello.', variety: 'en-US' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      providerKind: 'provider-unavailable',
      retryable: false,
      usage: {
        inputTokens: 4,
        cachedInputTokens: 0,
        outputTokens: 8,
        reasoningTokens: 0,
        totalTokens: 12,
      },
    });
  });

  it('maps a stalled speech response body to the shared timeout failure', async () => {
    const client = createOpenAiSpeechClient(async (_url, init) => {
      const requestSignal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            requestSignal?.addEventListener(
              'abort',
              () => controller.error(requestSignal.reason),
              { once: true },
            );
          },
        }),
        { status: 200 },
      );
    }, 1);

    await expect(
      client.generate(
        { apiKey: 'sk-test', text: 'Hello.', variety: 'en-US' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      providerKind: 'timeout',
      retryable: true,
    });
  });


  it('completes at speech.audio.done without waiting for the connection to close', async () => {
    const client = createOpenAiSpeechClient(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse));
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      client.generate(
        { apiKey: 'sk-test', text: 'Hello.', variety: 'en-US' },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      result: { audioBase64: 'AQIDBA==' },
      usage: { totalTokens: 1_013 },
    });
  });

  it('preserves reported usage when an audio chunk is not valid Base64', async () => {
    const client = createOpenAiSpeechClient(async () =>
      new Response(
        [
          'data: {"type":"speech.audio.delta","audio":"%%%"}',
          'data: {"type":"speech.audio.done","usage":{"input_tokens":4,"output_tokens":8,"total_tokens":12}}',
        ].join('\n'),
        { status: 200 },
      ),
    );

    await expect(
      client.generate(
        { apiKey: 'sk-test', text: 'Hello.', variety: 'en-US' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      providerKind: 'provider-unavailable',
      retryable: false,
      usage: {
        inputTokens: 4,
        cachedInputTokens: 0,
        outputTokens: 8,
        reasoningTokens: 0,
        totalTokens: 12,
      },
    });
  });
  it('rejects provider usage beyond the reserved per-chunk output cap', async () => {
    const client = createOpenAiSpeechClient(async () =>
      new Response(
        [
          'data: {"type":"speech.audio.delta","audio":"AQID"}',
          'data: {"type":"speech.audio.done","usage":{"input_tokens":4,"output_tokens":32001,"total_tokens":32005}}',
        ].join('\n'),
        { status: 200 },
      ),
    );

    await expect(
      client.generate(
        { apiKey: 'sk-test', text: 'Hello.', variety: 'en-US' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      providerKind: 'provider-unavailable',
      retryable: false,
      usage: {
        inputTokens: 4,
        outputTokens: 32_001,
        totalTokens: 32_005,
      },
    });
  });
});
