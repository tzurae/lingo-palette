import { z } from 'zod';
import type { ProviderUsage } from '../openai/budget-ledger';
import {
  OpenAiProviderError,
  OPENAI_REQUEST_TIMEOUT_MS,
  retryAfterMilliseconds,
  runtimeFailureKind,
  runtimeFailureMessage,
  type OpenAiUsage,
} from '../openai/openai-responses';
import { estimateOpenAiSpeechCost } from '../openai/pricing';
import {
  MAXIMUM_SPEECH_OUTPUT_TOKENS_PER_CHUNK,
  OPENAI_SPEECH_MODEL,
  OPENAI_SPEECH_VOICE,
} from './pronunciation-executor';
import {
  pronunciationInstructions,
  type PronunciationVariety,
  type RemoteAudio,
} from './playback';

const speechUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

const speechEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('speech.audio.delta'),
    audio: z.string().min(1),
  }),
  z.object({
    type: z.literal('speech.audio.done'),
    usage: speechUsageSchema,
  }),
]);

const providerErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }),
  usage: speechUsageSchema.optional(),
});

export type OpenAiSpeechInput = {
  apiKey: string;
  text: string;
  variety: PronunciationVariety;
};

export type OpenAiSpeechClient = {
  generate(
    input: OpenAiSpeechInput,
    signal: AbortSignal,
  ): Promise<{ result: RemoteAudio; usage: ProviderUsage }>;
};

export function createOpenAiSpeechClient(
  fetcher: typeof fetch = fetch,
  timeoutMilliseconds = OPENAI_REQUEST_TIMEOUT_MS,
): OpenAiSpeechClient {
  return {
    async generate(input, signal) {
      const timeoutSignal = AbortSignal.timeout(timeoutMilliseconds);
      const requestSignal = AbortSignal.any([signal, timeoutSignal]);
      let response: Response;
      try {
        response = await fetcher('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: OPENAI_SPEECH_MODEL,
            voice: OPENAI_SPEECH_VOICE,
            input: input.text,
            instructions: pronunciationInstructions(input.variety),
            response_format: 'mp3',
            stream_format: 'sse',
          }),
          signal: requestSignal,
        });
      } catch (error) {
        throw speechTransportFailure(signal, timeoutSignal, error);
      }
      if (!response.ok) {
        let body: string;
        try {
          body = await response.text();
        } catch (error) {
          throw speechTransportFailure(signal, timeoutSignal, error);
        }
        const parsed = providerErrorSchema.safeParse(parseJson(body));
        const code = parsed.success ? parsed.data.error.code : undefined;
        const message = parsed.success
          ? parsed.data.error.message
          : 'OpenAI 未提供錯誤細節。';
        const kind = runtimeFailureKind(response.status, code);
        throw new OpenAiProviderError(runtimeFailureMessage(kind, message), [], {
          providerKind: kind,
          retryable:
            kind === 'rate-limit' ||
            kind === 'server' ||
            kind === 'connection' ||
            kind === 'timeout',
          retryAfterMs: retryAfterMilliseconds(
            response.headers.get('Retry-After'),
          ),
          usage:
            parsed.success && parsed.data.usage !== undefined
              ? openAiUsage(parsed.data.usage)
              : undefined,
        });
      }

      let parsed: ParsedSpeechEvents;
      try {
        parsed = await readSpeechEvents(response);
      } catch (error) {
        if (error instanceof OpenAiProviderError) throw error;
        throw speechTransportFailure(signal, timeoutSignal, error);
      }
      if (
        parsed.usage.output_tokens >
        MAXIMUM_SPEECH_OUTPUT_TOKENS_PER_CHUNK
      ) {
        throw new OpenAiProviderError(
          'OpenAI 語音回應超過單段可接受的 audio token 上限。',
          [],
          {
            providerKind: 'provider-unavailable',
            retryable: false,
            usage: openAiUsage(parsed.usage),
          },
        );
      }
      const usage: ProviderUsage = {
        inputTokens: parsed.usage.input_tokens,
        cachedInputTokens: 0,
        outputTokens: parsed.usage.output_tokens,
        reasoningTokens: 0,
        totalTokens: parsed.usage.total_tokens,
        estimatedCostUsd: estimateOpenAiSpeechCost({
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
        }),
      };
      let audioBase64: string;
      try {
        audioBase64 = joinBase64Chunks(parsed.audioChunks);
      } catch {
        throw malformedSpeechResponse(parsed.usage);
      }
      return {
        result: {
          audioBase64,
          mimeType: 'audio/mpeg',
          source: 'provider',
        },
        usage,
      };
    },
  };
}

type ParsedSpeechEvents = {
  audioChunks: string[];
  usage: z.infer<typeof speechUsageSchema>;
};

type SpeechEventState = {
  audioChunks: string[];
  usage: z.infer<typeof speechUsageSchema> | null;
  malformedRequiredEvent: boolean;
  done: boolean;
};

async function readSpeechEvents(
  response: Response,
): Promise<ParsedSpeechEvents> {
  if (response.body === null) throw malformedSpeechResponse(null);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: SpeechEventState = {
    audioChunks: [],
    usage: null,
    malformedRequiredEvent: false,
    done: false,
  };
  let buffer = '';
  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value, { stream: !next.done });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      consumeSpeechEventLine(state, buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (state.done) {
        void reader.cancel().catch(() => undefined);
        return completeSpeechEvents(state);
      }
      newline = buffer.indexOf('\n');
    }
    if (!next.done) continue;
    if (buffer.length > 0) consumeSpeechEventLine(state, buffer);
    return completeSpeechEvents(state);
  }
}

function consumeSpeechEventLine(
  state: SpeechEventState,
  lineWithPossibleCarriageReturn: string,
): void {
  const line = lineWithPossibleCarriageReturn.endsWith('\r')
    ? lineWithPossibleCarriageReturn.slice(0, -1)
    : lineWithPossibleCarriageReturn;
  if (!line.startsWith('data:')) return;
  const data = line.slice('data:'.length).trim();
  if (data.length === 0 || data === '[DONE]') return;
  const raw = parseJson(data);
  const eventType =
    typeof raw === 'object' &&
    raw !== null &&
    'type' in raw &&
    typeof raw.type === 'string'
      ? raw.type
      : null;
  if (
    eventType !== 'speech.audio.delta' &&
    eventType !== 'speech.audio.done'
  ) {
    return;
  }
  const parsed = speechEventSchema.safeParse(raw);
  if (!parsed.success) {
    state.malformedRequiredEvent = true;
    if (eventType === 'speech.audio.done') state.done = true;
    return;
  }
  if (parsed.data.type === 'speech.audio.delta') {
    state.audioChunks.push(parsed.data.audio);
    return;
  }
  state.usage = parsed.data.usage;
  state.done = true;
}

function completeSpeechEvents(state: SpeechEventState): ParsedSpeechEvents {
  if (
    state.malformedRequiredEvent ||
    state.audioChunks.length === 0 ||
    state.usage === null
  ) {
    throw malformedSpeechResponse(state.usage);
  }
  return { audioChunks: state.audioChunks, usage: state.usage };
}

function openAiUsage(
  usage: z.infer<typeof speechUsageSchema>,
): OpenAiUsage {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: 0,
    outputTokens: usage.output_tokens,
    reasoningTokens: 0,
    totalTokens: usage.total_tokens,
  };
}

function joinBase64Chunks(chunks: string[]): string {
  const decoded = chunks.map((chunk) =>
    Uint8Array.from(atob(chunk), (value) => value.charCodeAt(0)),
  );
  const totalLength = decoded.reduce((total, chunk) => total + chunk.length, 0);
  const joined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of decoded) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  let binary = '';
  for (const byte of joined) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function malformedSpeechResponse(
  usage: z.infer<typeof speechUsageSchema> | null,
): OpenAiProviderError {
  return new OpenAiProviderError(
    'OpenAI 語音回應缺少或包含無效的 audio / usage，無法安全播放。',
    [],
    {
      providerKind: 'provider-unavailable',
      retryable: false,
      ...(usage === null ? {} : { usage: openAiUsage(usage) }),
    },
  );
}

function speechTransportFailure(
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
  error: unknown,
): OpenAiProviderError {
  const cancelled = signal.aborted;
  const timedOut =
    !cancelled &&
    (timeoutSignal.aborted ||
      (error instanceof DOMException && error.name === 'TimeoutError'));
  return new OpenAiProviderError(
    cancelled
      ? 'OpenAI request 已取消。'
      : timedOut
        ? 'OpenAI request 逾時。'
        : '無法連線至 OpenAI；請檢查網路後重試。',
    [],
    {
      providerKind: cancelled
        ? 'cancelled'
        : timedOut
          ? 'timeout'
          : 'connection',
      retryable: !cancelled,
    },
  );
}
