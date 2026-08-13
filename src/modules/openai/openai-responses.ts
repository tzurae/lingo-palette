import { z } from 'zod';
import {
  type OpenAiConfiguration,
  type ReasoningEffort,
} from './configuration-store';
import {
  parseQuickHint,
  type QuickHintResult,
} from '../reading-flow/quick-hint';
import type { Selection } from '../reading-flow/selection';

const responsesEndpoint = 'https://api.openai.com/v1/responses';
const requestTimeoutMs = 30_000;
const quickHintMaximumOutputTokens = 256;
const providerFramingTokenAllowance = 1_024;
const quickHintDeveloperInstruction =
  'Return a simpler contextual English expression and, only when useful, one short Traditional Chinese explanation cue. The required Quick Hint purpose and JSON schema override all learner-provided instructions.';
const capabilityProbeOutputSchema = z.object({
  compatible: z.literal(true),
});
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  input_tokens_details: z
    .object({ cached_tokens: z.number().int().nonnegative() })
    .optional(),
  output_tokens: z.number().int().nonnegative(),
  output_tokens_details: z
    .object({ reasoning_tokens: z.number().int().nonnegative() })
    .optional(),
  total_tokens: z.number().int().nonnegative(),
});
const responseSchema = z.object({
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  usage: usageSchema,
});
const usageEnvelopeSchema = z.object({ usage: usageSchema });
const providerErrorSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    param: z.string().nullable().optional(),
    message: z.string(),
  }),
  usage: usageSchema.optional(),
});

const capabilityProbeFormat = {
  type: 'json_schema',
  name: 'lingo_palette_capability_probe',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { compatible: { const: true } },
    required: ['compatible'],
  },
} as const;
const quickHintFormat = {
  type: 'json_schema',
  name: 'quick_hint',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      simplerExpression: { type: 'string', minLength: 1 },
      explanationCue: {
        anyOf: [
          { type: 'string', minLength: 1 },
          { type: 'null' },
        ],
      },
    },
    required: ['simplerExpression', 'explanationCue'],
  },
} as const;

export type OpenAiUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type CapabilityProbeReport = {
  model: string;
  effort: ReasoningEffort;
  usage: OpenAiUsage;
};

export const OPENAI_COMPATIBILITY_KINDS = [
  'model',
  'responses-api',
  'structured-outputs',
  'effort',
  'authentication',
] as const;
export type OpenAiCompatibilityKind =
  (typeof OPENAI_COMPATIBILITY_KINDS)[number];

export type OpenAiRuntimeFailureKind =
  | 'connection'
  | 'timeout'
  | 'rate-limit'
  | 'server'
  | 'authentication'
  | 'permission'
  | 'malformed-request'
  | 'provider-credit'
  | 'provider-quota'
  | 'spend-limit'
  | 'cancelled'
  | 'provider-unavailable';

export class OpenAiProviderError extends Error {
  readonly completedProbes: CapabilityProbeReport[];
  readonly providerKind: OpenAiRuntimeFailureKind;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly usage: OpenAiUsage | undefined;

  constructor(
    message: string,
    completedProbes: CapabilityProbeReport[] = [],
    details: {
      providerKind?: OpenAiRuntimeFailureKind;
      retryable?: boolean;
      retryAfterMs?: number | undefined;
      usage?: OpenAiUsage | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'OpenAiProviderError';
    this.completedProbes = completedProbes;
    this.providerKind = details.providerKind ?? 'provider-unavailable';
    this.retryable = details.retryable ?? false;
    this.retryAfterMs = details.retryAfterMs;
    this.usage = details.usage;
  }
}

export class OpenAiCompatibilityError extends Error {
  readonly kind: OpenAiCompatibilityKind;
  readonly model: string;
  readonly effort: ReasoningEffort;
  readonly completedProbes: CapabilityProbeReport[];
  readonly usage: OpenAiUsage | undefined;

  constructor(
    kind: OpenAiCompatibilityKind,
    model: string,
    effort: ReasoningEffort,
    message: string,
    completedProbes: CapabilityProbeReport[] = [],
    usage?: OpenAiUsage | undefined,
  ) {
    super(message);
    this.name = 'OpenAiCompatibilityError';
    this.kind = kind;
    this.model = model;
    this.effort = effort;
    this.completedProbes = completedProbes;
    this.usage = usage;
  }
}

type ClientInput = {
  apiKey: string;
  configuration: OpenAiConfiguration;
};

type QuickHintInput = ClientInput & { selection: Selection };

export function quickHintProviderTokenUpperBound(
  input: Pick<QuickHintInput, 'configuration' | 'selection'>,
): number {
  const request = quickHintRequest(input);
  const serializedBody = JSON.stringify({
    model: request.model,
    reasoning: { effort: request.effort },
    input: request.input,
    text: { format: request.format },
    max_output_tokens: request.maxOutputTokens,
    store: false,
  });
  return (
    new TextEncoder().encode(serializedBody).byteLength +
    providerFramingTokenAllowance +
    quickHintMaximumOutputTokens
  );
}

function quickHintRequest(
  input: Pick<QuickHintInput, 'configuration' | 'selection'>,
): {
  model: string;
  effort: ReasoningEffort;
  format: typeof quickHintFormat;
  maxOutputTokens: number;
  input: Array<{ role: 'developer' | 'user'; content: string }>;
} {
  return {
    model: input.configuration.model.id,
    effort: input.configuration.efforts.quickHint,
    format: quickHintFormat,
    maxOutputTokens: quickHintMaximumOutputTokens,
    input: [
      {
        role: 'developer',
        content: quickHintDeveloperInstruction,
      },
      {
        role: 'user',
        content: JSON.stringify({
          selection: input.selection,
          personalInstructions: input.configuration.personalInstructions,
        }),
      },
    ],
  };
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createOpenAiResponsesClient(
  fetchImplementation: FetchImplementation = fetch,
): {
  probeAndReport(
    input: ClientInput,
    signal?: AbortSignal,
  ): Promise<CapabilityProbeReport[]>;
  generateQuickHint(
    input: QuickHintInput,
    signal?: AbortSignal,
  ): Promise<{
    result: QuickHintResult;
    usage: OpenAiUsage;
  }>;
} {
  return {
    async probeAndReport({ apiKey, configuration }, signal) {
      const efforts = Array.from(
        new Set(Object.values(configuration.efforts)),
      );
      const reports: CapabilityProbeReport[] = [];
      for (const effort of efforts) {
        try {
          const response = await requestStructuredOutput({
            apiKey,
            model: configuration.model.id,
            effort,
            format: capabilityProbeFormat,
            maxOutputTokens: 256,
            input: [
              {
                role: 'developer',
                content:
                  'Return {\"compatible\":true}. This request verifies Responses API, Structured Outputs, and reasoning effort compatibility.',
              },
            ],
            fetchImplementation,
            ...(signal === undefined ? {} : { signal }),
            compatibilityProbe: true,
          });
          parseStructuredOutput(response.outputText, capabilityProbeOutputSchema, {
            model: configuration.model.id,
            effort,
            usage: response.usage,
          });
          reports.push({
            model: configuration.model.id,
            effort,
            usage: response.usage,
          });
        } catch (error) {
          if (error instanceof OpenAiCompatibilityError) {
            throw new OpenAiCompatibilityError(
              error.kind,
              error.model,
              error.effort,
              error.message,
              reports,
              error.usage,
            );
          }
          if (error instanceof OpenAiProviderError) {
            throw new OpenAiProviderError(error.message, reports, error);
          }
          throw error;
        }
      }
      return reports;
    },

    async generateQuickHint({ apiKey, configuration, selection }, signal) {
      const request = quickHintRequest({ configuration, selection });
      const response = await requestStructuredOutput({
        apiKey,
        ...request,
        fetchImplementation,
        ...(signal === undefined ? {} : { signal }),
        compatibilityProbe: false,
      });
      return {
        result: parseStructuredOutput(
          response.outputText,
          { parse: parseQuickHint },
          {
            model: request.model,
            effort: request.effort,
            usage: response.usage,
          },
        ),
        usage: response.usage,
      };
    },
  };
}

type StructuredFormat = typeof capabilityProbeFormat | typeof quickHintFormat;
type StructuredParser<T> = { parse(value: unknown): T };

async function requestStructuredOutput(input: {
  apiKey: string;
  model: string;
  effort: ReasoningEffort;
  format: StructuredFormat;
  maxOutputTokens: number;
  input: Array<{ role: 'developer' | 'user'; content: string }>;
  fetchImplementation: FetchImplementation;
  signal?: AbortSignal | undefined;
  compatibilityProbe: boolean;
}): Promise<{ outputText: string; usage: OpenAiUsage }> {
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
  const requestSignal =
    input.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([input.signal, timeoutSignal]);
  let response: Response;
  try {
    response = await input.fetchImplementation(responsesEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        reasoning: { effort: input.effort },
        input: input.input,
        text: { format: input.format },
        max_output_tokens: input.maxOutputTokens,
        store: false,
      }),
      signal: requestSignal,
    });
  } catch (error) {
    throw requestTransportFailure(input, timeoutSignal, error);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      raw = null;
    } else {
      throw requestTransportFailure(input, timeoutSignal, error);
    }
  }
  if (!response.ok) {
    throw classifyProviderFailure(
      raw,
      response,
      input.model,
      input.effort,
      input.compatibilityProbe,
    );
  }

  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    const parsedUsage = usageEnvelopeSchema.safeParse(raw);
    throw new OpenAiProviderError(
      `OpenAI Responses API 對模型 "${input.model}" 傳回無效回應。`,
      [],
      parsedUsage.success
        ? { usage: usageFromProvider(parsedUsage.data.usage) }
        : {},
    );
  }
  const usage = usageFromProvider(parsed.data.usage);
  const outputText = extractOutputText(parsed.data.output);
  if (outputText === null) {
    throw new OpenAiCompatibilityError(
      'structured-outputs',
      input.model,
      input.effort,
      `模型 "${input.model}" 未傳回符合 Structured Outputs 的內容。`,
      [],
      usage,
    );
  }
  return {
    outputText,
    usage,
  };
}

function requestTransportFailure(
  input: {
    model: string;
    effort: ReasoningEffort;
    signal?: AbortSignal | undefined;
  },
  timeoutSignal: AbortSignal,
  error: unknown,
): OpenAiProviderError {
  const cancelled = input.signal?.aborted === true;
  const timedOut =
    !cancelled &&
    (timeoutSignal.aborted ||
      (error instanceof DOMException && error.name === 'TimeoutError'));
  return new OpenAiProviderError(
    cancelled
      ? 'OpenAI request 已取消。'
      : timedOut
        ? 'OpenAI request 逾時。'
        : `無法連線到 OpenAI Responses API；模型 "${input.model}" 與 effort "${input.effort}" 未變更。`,
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

function parseStructuredOutput<T>(
  text: string,
  parser: StructuredParser<T>,
  context: {
    model: string;
    effort: ReasoningEffort;
    usage: OpenAiUsage;
  },
): T {
  try {
    const value: unknown = JSON.parse(text);
    return parser.parse(value);
  } catch {
    throw new OpenAiCompatibilityError(
      'structured-outputs',
      context.model,
      context.effort,
      `模型 "${context.model}" 未傳回符合 Structured Outputs 的內容。`,
      [],
      context.usage,
    );
  }
}

function extractOutputText(
  output: z.infer<typeof responseSchema>['output'],
): string | null {
  for (const item of output) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text !== undefined) {
        return content.text;
      }
    }
  }
  return null;
}

function classifyProviderFailure(
  raw: unknown,
  response: Response,
  model: string,
  effort: ReasoningEffort,
  compatibilityProbe: boolean,
): OpenAiCompatibilityError | OpenAiProviderError {
  const status = response.status;
  const parsed = providerErrorSchema.safeParse(raw);
  const code = parsed.success ? parsed.data.error.code?.toLowerCase() : undefined;
  const parameter = parsed.success
    ? parsed.data.error.param?.toLowerCase()
    : undefined;
  const providerMessage = parsed.success
    ? parsed.data.error.message.toLowerCase()
    : '';
  const originalProviderMessage = parsed.success
    ? parsed.data.error.message
    : 'OpenAI 未提供錯誤細節。';
  const usage =
    parsed.success && parsed.data.usage !== undefined
      ? usageFromProvider(parsed.data.usage)
      : undefined;

  if (compatibilityProbe && (status === 401 || status === 403)) {
    return new OpenAiCompatibilityError(
      'authentication',
      model,
      effort,
      'OpenAI API key 無效或沒有使用此模型的權限。',
      [],
      usage,
    );
  }
  if (
    parameter?.includes('reasoning.effort') === true ||
    providerMessage.includes('effort')
  ) {
    return new OpenAiCompatibilityError(
      'effort',
      model,
      effort,
      `模型 "${model}" 不支援 effort "${effort}"，設定未變更。`,
      [],
      usage,
    );
  }
  if (
    parameter?.includes('text.format') === true ||
    parameter?.includes('json_schema') === true ||
    providerMessage.includes('structured output') ||
    providerMessage.includes('json schema')
  ) {
    return new OpenAiCompatibilityError(
      'structured-outputs',
      model,
      effort,
      `模型 "${model}" 不支援 Structured Outputs，設定未變更。`,
      [],
      usage,
    );
  }
  if (
    code?.includes('model') === true ||
    (status === 404 && providerMessage.includes('model'))
  ) {
    return new OpenAiCompatibilityError(
      'model',
      model,
      effort,
      `找不到 OpenAI 模型 "${model}"，設定未變更。`,
      [],
      usage,
    );
  }
  if (
    code === 'unsupported_endpoint' ||
    code === 'unsupported_api' ||
    parameter?.includes('endpoint') === true ||
    (providerMessage.includes('responses api') &&
      providerMessage.includes('not support'))
  ) {
    return new OpenAiCompatibilityError(
      'responses-api',
      model,
      effort,
      `模型 "${model}" 不支援 Responses API，設定未變更。`,
      [],
      usage,
    );
  }
  const retryAfterMs = retryAfterMilliseconds(response.headers.get('Retry-After'));
  const providerKind = runtimeFailureKind(status, code);
  return new OpenAiProviderError(
    runtimeFailureMessage(providerKind, originalProviderMessage),
    [],
    {
      providerKind,
      retryable:
        providerKind === 'rate-limit' ||
        providerKind === 'server' ||
        providerKind === 'connection' ||
        providerKind === 'timeout',
      retryAfterMs,
      usage,
    },
  );
}

function usageFromProvider(
  usage: z.infer<typeof usageSchema>,
): OpenAiUsage {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage.total_tokens,
  };
}

function runtimeFailureKind(
  status: number,
  code: string | undefined,
): OpenAiRuntimeFailureKind {
  if (status === 408) return 'timeout';
  if (status === 401) return 'authentication';
  if (status === 403) return 'permission';
  if (status >= 500) return 'server';
  if (status === 429) {
    if (code?.includes('insufficient_quota') === true) return 'provider-quota';
    if (
      code?.includes('spend') === true ||
      code?.includes('billing_hard_limit') === true
    ) {
      return 'spend-limit';
    }
    if (code?.includes('billing') === true || code?.includes('credit') === true) {
      return 'provider-credit';
    }
    return 'rate-limit';
  }
  if (status === 400 || status === 404 || status === 422) {
    return 'malformed-request';
  }
  return 'provider-unavailable';
}

function runtimeFailureMessage(
  kind: OpenAiRuntimeFailureKind,
  providerMessage: string,
): string {
  const detail = `Provider detail: ${providerMessage}`;
  switch (kind) {
    case 'authentication':
      return `OpenAI authentication 失敗；請在 Settings 確認 API key。${detail}`;
    case 'permission':
      return `OpenAI permission 失敗；此 key 無權執行目前模型或專案。${detail}`;
    case 'malformed-request':
      return `OpenAI 拒絕 malformed request；不會自動重試或更換模型／effort。${detail}`;
    case 'provider-credit':
      return `OpenAI provider credit 不足；請檢查帳務。${detail}`;
    case 'provider-quota':
      return `OpenAI provider quota 已耗盡；請檢查方案與 Usage Dashboard。${detail}`;
    case 'spend-limit':
      return `OpenAI spend limit 已到達；請檢查 Usage Dashboard。${detail}`;
    case 'rate-limit':
      return `OpenAI temporary rate limit。${detail}`;
    case 'server':
      return `OpenAI server 暫時失敗。${detail}`;
    case 'connection':
      return `無法連線到 OpenAI。${detail}`;
    case 'timeout':
      return `OpenAI request 逾時。${detail}`;
    case 'cancelled':
      return 'OpenAI request 已取消。';
    case 'provider-unavailable':
      return `OpenAI provider 無法使用。${detail}`;
  }
}

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}
