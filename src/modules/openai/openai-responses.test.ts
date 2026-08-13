import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { OpenAiConfiguration } from './configuration-store';
import {
  createOpenAiResponsesClient,
  OpenAiCompatibilityError,
  OpenAiProviderError,
} from './openai-responses';

const customConfiguration: OpenAiConfiguration = {
  model: { kind: 'custom', id: 'gpt-custom-exact' },
  efforts: { quickHint: 'low', deepDive: 'medium', review: 'low' },
  personalInstructions: 'Keep the Traditional Chinese cue very short.',
};
const requestBodySchema = z
  .object({
    model: z.string(),
    reasoning: z.object({ effort: z.string() }),
    store: z.boolean(),
    max_output_tokens: z.number(),
    text: z.object({
      format: z.object({
        type: z.string(),
        name: z.string(),
        strict: z.boolean(),
      }),
    }),
  })
  .passthrough();

function parseRequestBody(init: RequestInit | undefined) {
  const value: unknown = JSON.parse(String(init?.body));
  return requestBodySchema.parse(value);
}


function completedResponse(
  output: unknown,
  usage = {
    input_tokens: 11,
    input_tokens_details: { cached_tokens: 3 },
    output_tokens: 7,
    output_tokens_details: { reasoning_tokens: 2 },
    total_tokens: 18,
  },
): Response {
  return Response.json({
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(output) }],
      },
    ],
    usage,
  });
}

describe('OpenAI Responses client', () => {
  it('runs one foreground strict-schema probe per distinct configured effort and reports usage', async () => {
    const requests: Array<z.infer<typeof requestBodySchema>> = [];
    const client = createOpenAiResponsesClient(async (_input, init) => {
      requests.push(parseRequestBody(init));
      return completedResponse({ compatible: true });
    });

    await expect(
      client.probeAndReport({
        apiKey: 'sk-probe',
        configuration: customConfiguration,
      }),
    ).resolves.toEqual([
      {
        model: 'gpt-custom-exact',
        effort: 'low',
        usage: {
          inputTokens: 11,
          cachedInputTokens: 3,
          outputTokens: 7,
          reasoningTokens: 2,
          totalTokens: 18,
        },
      },
      {
        model: 'gpt-custom-exact',
        effort: 'medium',
        usage: {
          inputTokens: 11,
          cachedInputTokens: 3,
          outputTokens: 7,
          reasoningTokens: 2,
          totalTokens: 18,
        },
      },
    ]);

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.model)).toEqual([
      'gpt-custom-exact',
      'gpt-custom-exact',
    ]);
    expect(requests.map((request) => request.reasoning.effort)).toEqual([
      'low',
      'medium',
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        store: false,
        max_output_tokens: 256,
        text: {
          format: {
            type: 'json_schema',
            name: 'lingo_palette_capability_probe',
            strict: true,
          },
        },
      });
    }
  });

  it('rejects a probe that does not positively confirm compatibility', async () => {
    const client = createOpenAiResponsesClient(async () =>
      completedResponse({ compatible: false }),
    );

    await expect(
      client.probeAndReport({
        apiKey: 'sk-probe',
        configuration: customConfiguration,
      }),
    ).rejects.toMatchObject({
      kind: 'structured-outputs',
      model: 'gpt-custom-exact',
      effort: 'low',
    });
  });

  it('keeps completed probe usage when a later effort is incompatible', async () => {
    let attempt = 0;
    const client = createOpenAiResponsesClient(async () => {
      attempt += 1;
      return attempt === 1
        ? completedResponse({ compatible: true })
        : Response.json(
            {
              error: {
                code: 'invalid_value',
                param: 'reasoning.effort',
                message: 'Unsupported effort',
              },
            },
            { status: 400 },
          );
    });

    await expect(
      client.probeAndReport({
        apiKey: 'sk-probe',
        configuration: customConfiguration,
      }),
    ).rejects.toMatchObject({
      kind: 'effort',
      effort: 'medium',
      completedProbes: [
        {
          model: 'gpt-custom-exact',
          effort: 'low',
          usage: {
            inputTokens: 11,
            cachedInputTokens: 3,
            outputTokens: 7,
            reasoningTokens: 2,
            totalTokens: 18,
          },
        },
      ],
    });
  });

  it.each([
    {
      response: Response.json(
        { error: { code: 'model_not_found', message: 'Unknown model' } },
        { status: 404 },
      ),
      kind: 'model',
      message: '找不到 OpenAI 模型 "gpt-custom-exact"',
    },
    {
      response: Response.json(
        { error: { code: 'unsupported_endpoint', message: 'Use another API' } },
        { status: 400 },
      ),
      kind: 'responses-api',
      message: '模型 "gpt-custom-exact" 不支援 Responses API',
    },
    {
      response: Response.json(
        {
          error: {
            code: 'invalid_request_error',
            param: 'text.format',
            message: 'Structured outputs are not supported',
          },
        },
        { status: 400 },
      ),
      kind: 'structured-outputs',
      message: '模型 "gpt-custom-exact" 不支援 Structured Outputs',
    },
    {
      response: Response.json(
        {
          error: {
            code: 'invalid_value',
            param: 'reasoning.effort',
            message: 'Unsupported effort for this model',
          },
        },
        { status: 400 },
      ),
      kind: 'effort',
      message: '模型 "gpt-custom-exact" 不支援 effort "low"',
    },
  ])('reports exact $kind incompatibility without fallback', async ({ response, kind, message }) => {
    const requests: Array<z.infer<typeof requestBodySchema>> = [];
    const client = createOpenAiResponsesClient(async (_input, init) => {
      requests.push(parseRequestBody(init));
      return response;
    });

    const failure = client.probeAndReport({
      apiKey: 'sk-probe',
      configuration: customConfiguration,
    });

    await expect(failure).rejects.toBeInstanceOf(OpenAiCompatibilityError);
    await expect(failure).rejects.toMatchObject({ kind });
    await expect(failure).rejects.toThrow(message);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: 'gpt-custom-exact',
      reasoning: { effort: 'low' },
    });
  });

  it.each([
    {
      status: 429,
      code: 'rate_limit_exceeded',
      message: 'Rate limit reached',
    },
    {
      status: 503,
      code: 'server_error',
      message: 'Service unavailable',
    },
  ])('does not misreport HTTP $status as capability incompatibility', async ({ status, code, message }) => {
    const client = createOpenAiResponsesClient(async () =>
      Response.json({ error: { code, message } }, { status }),
    );
    const failure = client.probeAndReport({
      apiKey: 'sk-probe',
      configuration: customConfiguration,
    });

    await expect(failure).rejects.toBeInstanceOf(OpenAiProviderError);
    await expect(failure).rejects.not.toBeInstanceOf(OpenAiCompatibilityError);
    await expect(failure).rejects.not.toThrow('不支援 Responses API');
  });

  it('keeps Personal Instructions subordinate to the built-in Quick Hint schema', async () => {
    let request: z.infer<typeof requestBodySchema> | undefined;
    const client = createOpenAiResponsesClient(async (_input, init) => {
      request = parseRequestBody(init);
      return completedResponse({
        simplerExpression: 'delay until later',
        explanationCue: '延後處理',
      });
    });

    await expect(
      client.generateQuickHint({
        apiKey: 'sk-runtime',
        configuration: customConfiguration,
        selection: {
          text: 'postpone',
          context: { before: 'They decided to ', after: ' the vote.' },
        },
      }),
    ).resolves.toEqual({
      result: {
        simplerExpression: 'delay until later',
        explanationCue: '延後處理',
      },
      usage: {
        inputTokens: 11,
        cachedInputTokens: 3,
        outputTokens: 7,
        reasoningTokens: 2,
        totalTokens: 18,
      },
    });

    expect(request).toMatchObject({
      model: 'gpt-custom-exact',
      reasoning: { effort: 'low' },
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'quick_hint',
          strict: true,
        },
      },
    });
    const serialized = JSON.stringify(request);
    expect(serialized).toContain('Keep the Traditional Chinese cue very short.');
    expect(serialized).toContain('postpone');
    expect(serialized).not.toMatch(/url|title|DOM|permission|Lookup history/i);
  });

  it.each([
    {
      status: 401,
      body: { error: { code: 'invalid_api_key', message: 'Invalid key' } },
      kind: 'authentication',
      retryable: false,
    },
    {
      status: 403,
      body: { error: { code: 'permission_denied', message: 'Denied' } },
      kind: 'permission',
      retryable: false,
    },
    {
      status: 400,
      body: { error: { code: 'invalid_request_error', message: 'Bad input' } },
      kind: 'malformed-request',
      retryable: false,
    },
    {
      status: 429,
      body: {
        error: { code: 'insufficient_quota', message: 'Quota exhausted' },
      },
      kind: 'provider-quota',
      retryable: false,
    },
    {
      status: 429,
      body: {
        error: { code: 'billing_hard_limit_reached', message: 'Spend limit' },
      },
      kind: 'spend-limit',
      retryable: false,
    },
    {
      status: 429,
      body: {
        error: {
          code: 'rate_limit_exceeded',
          message: 'Temporary rate limit',
        },
      },
      kind: 'rate-limit',
      retryable: true,
      retryAfterMs: 2_000,
    },
    {
      status: 500,
      body: { error: { code: 'server_error', message: 'Server error' } },
      kind: 'server',
      retryable: true,
    },
  ] as const)(
    'classifies runtime $kind without fallback',
    async ({ status, body, kind, retryable, retryAfterMs }) => {
      const client = createOpenAiResponsesClient(async () =>
        Response.json(body, {
          status,
          ...(retryAfterMs === undefined
            ? {}
            : { headers: { 'Retry-After': String(retryAfterMs / 1_000) } }),
        }),
      );

      await expect(
        client.generateQuickHint({
          apiKey: 'sk-runtime',
          configuration: customConfiguration,
          selection: { text: 'postpone', context: { before: '', after: '' } },
        }),
      ).rejects.toMatchObject({
        providerKind: kind,
        retryable,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    },
  );

  it('classifies a timeout while reading the response body as retryable', async () => {
    const response = Response.json({});
    Object.defineProperty(response, 'json', {
      value: async () => {
        throw new DOMException('Body timed out', 'TimeoutError');
      },
    });
    const client = createOpenAiResponsesClient(async () => response);

    await expect(
      client.generateQuickHint({
        apiKey: 'sk-runtime',
        configuration: customConfiguration,
        selection: { text: 'postpone', context: { before: '', after: '' } },
      }),
    ).rejects.toMatchObject({
      providerKind: 'timeout',
      retryable: true,
    });
  });

  it('classifies a response-body connection failure as retryable', async () => {
    const response = Response.json({});
    Object.defineProperty(response, 'json', {
      value: async () => {
        throw new TypeError('terminated');
      },
    });
    const client = createOpenAiResponsesClient(async () => response);

    await expect(
      client.generateQuickHint({
        apiKey: 'sk-runtime',
        configuration: customConfiguration,
        selection: { text: 'postpone', context: { before: '', after: '' } },
      }),
    ).rejects.toMatchObject({
      providerKind: 'connection',
      retryable: true,
    });
  });

  it('retains reported usage on a capability incompatibility response', async () => {
    const client = createOpenAiResponsesClient(async () =>
      Response.json(
        {
          error: {
            code: 'invalid_value',
            param: 'reasoning.effort',
            message: 'Unsupported effort',
          },
          usage: {
            input_tokens: 13,
            output_tokens: 5,
            total_tokens: 18,
          },
        },
        { status: 400 },
      ),
    );

    await expect(
      client.probeAndReport({
        apiKey: 'sk-probe',
        configuration: customConfiguration,
      }),
    ).rejects.toMatchObject({
      kind: 'effort',
      usage: {
        inputTokens: 13,
        outputTokens: 5,
        totalTokens: 18,
      },
    });
  });

  it('reports a later Structured Outputs incompatibility without changing model or effort', async () => {
    const client = createOpenAiResponsesClient(async () =>
      completedResponse({ explanationCue: null }),
    );

    const failure = client.generateQuickHint({
      apiKey: 'sk-runtime',
      configuration: customConfiguration,
      selection: {
        text: 'postpone',
        context: { before: '', after: '' },
      },
    });

    await expect(failure).rejects.toMatchObject({
      kind: 'structured-outputs',
      model: 'gpt-custom-exact',
      effort: 'low',
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
      },
    });
  });
});
