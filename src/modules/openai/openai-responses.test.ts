import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { BUNDLED_ENGLISH_EVIDENCE_PACK } from '../evidence/bundled-english-evidence-pack';
import type { OpenAiConfiguration } from './configuration-store';
import {
  createOpenAiResponsesClient,
  deepDiveProviderTokenUpperBound,
  OpenAiCompatibilityError,
  OpenAiProviderError,
  reviewCandidateProviderTokenUpperBound,
  reviewEvaluationProviderTokenUpperBound,
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

  it('leaves reasoning headroom for the requested Quick Hint text', async () => {
    let request: z.infer<typeof requestBodySchema> | undefined;
    const client = createOpenAiResponsesClient(async (_input, init) => {
      request = parseRequestBody(init);
      if (request.max_output_tokens <= 256) {
        return Response.json({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ type: 'reasoning' }],
          usage: {
            input_tokens: 42,
            output_tokens: 256,
            output_tokens_details: { reasoning_tokens: 256 },
            total_tokens: 298,
          },
        });
      }
      return completedResponse({
        simplerExpression: 'plane',
        explanationCue: '飛機',
      });
    });

    await expect(
      client.generateQuickHint({
        apiKey: 'sk-runtime',
        configuration: customConfiguration,
        selection: {
          text: 'aircraft',
          context: { before: 'visits an ', after: ' carrier' },
        },
      }),
    ).resolves.toMatchObject({
      result: {
        simplerExpression: 'plane',
        explanationCue: '飛機',
      },
    });
    expect(request?.max_output_tokens).toBe(1_024);
  });

  it('keeps the default fetch receiver required by extension service workers', async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    globalThis.fetch = (function (this: unknown) {
      receiver = this;
      if (this !== globalThis) {
        return Promise.reject(new TypeError('Illegal invocation'));
      }
      return Promise.resolve(
        completedResponse({
          simplerExpression: 'plane',
          explanationCue: null,
        }),
      );
    }) as typeof fetch;

    try {
      const client = createOpenAiResponsesClient();
      await expect(
        client.generateQuickHint({
          apiKey: 'sk-runtime',
          configuration: customConfiguration,
          selection: {
            text: 'aircraft',
            context: { before: '', after: '' },
          },
        }),
      ).resolves.toMatchObject({
        result: {
          simplerExpression: 'plane',
          explanationCue: null,
        },
      });
      expect(receiver).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reports exhausted output headroom as an incomplete provider response', async () => {
    const client = createOpenAiResponsesClient(async () =>
      Response.json({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'reasoning' }],
        usage: {
          input_tokens: 42,
          output_tokens: 1_024,
          output_tokens_details: { reasoning_tokens: 1_024 },
          total_tokens: 1_066,
        },
      }),
    );

    const failure = client.generateQuickHint({
      apiKey: 'sk-runtime',
      configuration: customConfiguration,
      selection: {
        text: 'aircraft',
        context: { before: 'visits an ', after: ' carrier' },
      },
    });

    await expect(failure).rejects.toBeInstanceOf(OpenAiProviderError);
    await expect(failure).rejects.not.toBeInstanceOf(OpenAiCompatibilityError);
    await expect(failure).rejects.toMatchObject({
      providerKind: 'provider-unavailable',
      retryable: false,
      usage: {
        outputTokens: 1_024,
        reasoningTokens: 1_024,
      },
    });
    await expect(failure).rejects.toThrow('用完 1,024 個 output token 上限');
  });

  it('keeps the bounded Deep Dive payload beneath its extension-owned schema', async () => {
    let request: z.infer<typeof requestBodySchema> | undefined;
    const client = createOpenAiResponsesClient(async (_input, init) => {
      request = parseRequestBody(init);
      return completedResponse({
        contextualMeaning:
          'Here, “postpone” means deciding that the vote will happen later.',
        usageFit:
          'Neutral and suitable for an official committee decision.',
        grammarPattern: {
          pattern: 'postpone + noun / gerund',
          explanation: 'The complement names the delayed event.',
        },
        alternatives: [
          {
            expression: 'put off',
            distinction: 'More conversational than “postpone”.',
          },
        ],
        examples: [
          {
            sentence: 'The committee postponed the vote.',
            explanation: 'The noun phrase names the delayed event.',
          },
        ],
      });
    });
    const input = {
      apiKey: 'sk-runtime',
      configuration: customConfiguration,
      selection: {
        text: 'postpone',
        context: { before: 'They decided to ', after: ' the vote.' },
      },
    };

    await expect(client.generateDeepDive(input)).resolves.toMatchObject({
      result: {
        contextualMeaning: expect.stringContaining('happen later'),
        usageFit: expect.stringContaining('committee'),
        grammarPattern: { pattern: 'postpone + noun / gerund' },
        alternatives: [{ expression: 'put off' }],
        examples: [{ sentence: 'The committee postponed the vote.' }],
      },
      usage: { totalTokens: 18 },
    });

    expect(request).toMatchObject({
      model: 'gpt-custom-exact',
      reasoning: { effort: 'medium' },
      store: false,
      max_output_tokens: 2_048,
      text: {
        format: {
          type: 'json_schema',
          name: 'deep_dive',
          strict: true,
        },
      },
    });
    const serialized = JSON.stringify(request);
    expect(serialized).toContain('Keep the Traditional Chinese cue very short.');
    expect(serialized).toContain('postpone');
    expect(serialized).not.toMatch(/url|title|DOM|permission|Lookup history/i);
    expect(deepDiveProviderTokenUpperBound(input)).toBeGreaterThan(
      new TextEncoder().encode(serialized).byteLength,
    );
  });

  it('generates a bounded Review candidate with the configured review effort', async () => {
    let request: z.infer<typeof requestBodySchema> | undefined;
    const client = createOpenAiResponsesClient(async (_input, init) => {
      request = parseRequestBody(init);
      return completedResponse({
        type: 'contrastive',
        learningItemId: 'learning-1',
        encounterId: 'encounter-1',
        knowledgeDimension: 'contextual-meaning',
        prompt: 'What does postpone mean here?',
        contextQuote: 'They decided to postpone the vote.',
        acceptedAnswers: ['delay until later'],
        distractors: ['cancel permanently'],
        correctiveExplanation:
          'Here, postpone means moving the vote to a later time.',
      });
    });
    const input = {
      apiKey: 'sk-runtime',
      configuration: customConfiguration,
      knowledgeDimension: 'contextual-meaning' as const,
      context: {
        learningItem: {
          id: 'learning-1',
          expression: 'postpone',
          normalizedExpression: 'postpone',
          status: 'active' as const,
          sensePin: null,
          productiveUseIntent: false,
        },
        encounters: [
          {
            id: 'encounter-1',
            learningItemId: 'learning-1',
            selection: {
              text: 'postpone',
              context: {
                before: 'They decided to ',
                after: ' the vote.',
              },
            },
            sensePin: null,
          },
        ],
        generation: {
          model: 'gpt-custom-exact',
          promptVersion: 'review-prompt-v1',
        },
      },
    };

    await expect(
      client.generateReviewCandidate(input),
    ).resolves.toMatchObject({
      result: {
        learningItemId: 'learning-1',
        knowledgeDimension: 'contextual-meaning',
        acceptedAnswers: ['delay until later'],
      },
      usage: { totalTokens: 18 },
    });
    expect(request).toMatchObject({
      model: 'gpt-custom-exact',
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 2_048,
      text: {
        format: {
          type: 'json_schema',
          name: 'review_candidate_contextual_meaning',
          strict: true,
        },
      },
    });
    expect(reviewCandidateProviderTokenUpperBound(input)).toBeGreaterThan(
      new TextEncoder().encode(JSON.stringify(request)).byteLength,
    );
  });

  it('evaluates a Review candidate independently with evidence identifiers', async () => {
    let request: z.infer<typeof requestBodySchema> | undefined;
    const client = createOpenAiResponsesClient(async (_input, init) => {
      request = parseRequestBody(init);
      return completedResponse({
        grounding: 'pass',
        answerability: 'pass',
        linguisticAccuracy: 'pass',
        constructValidity: 'pass',
        distractorSafety: 'pass',
        correctiveExplanation: 'pass',
        validAlternativeAnswers: [],
        partialAnswers: [],
        evidenceAssessments: [
          {
            evidenceId:
              BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0]!.id,
            relation: 'supports',
          },
        ],
      });
    });
    const candidate = {
      type: 'contrastive' as const,
      learningItemId: 'learning-1',
      encounterId: 'encounter-1',
      knowledgeDimension: 'contextual-meaning' as const,
      prompt: 'What does postpone mean here?',
      contextQuote: 'They decided to postpone the vote.',
      acceptedAnswers: ['delay until later'],
      distractors: ['cancel permanently'],
      correctiveExplanation:
        'Here, postpone means moving the vote to a later time.',
    };

    const evaluationInput = {
      apiKey: 'sk-runtime',
      configuration: customConfiguration,
      learningItem: {
        id: 'learning-1',
        expression: 'postpone',
        normalizedExpression: 'postpone',
        status: 'active' as const,
        sensePin: null,
        productiveUseIntent: false,
      },
      encounter: {
        id: 'encounter-1',
        learningItemId: 'learning-1',
        selection: {
          text: 'postpone',
          context: {
            before: 'They decided to ',
            after: ' the vote.',
          },
        },
        sensePin: null,
      },
      candidate,
      evidence: [
        BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0]!,
      ],
    };

    await expect(
      client.evaluateReviewCandidate(evaluationInput),
    ).resolves.toMatchObject({
      result: {
        grounding: 'pass',
        evidenceAssessments: [
          {
            evidenceId:
              BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0]!.id,
          },
        ],
      },
      usage: { totalTokens: 18 },
    });
    expect(request).toMatchObject({
      reasoning: { effort: 'low' },
      text: {
        format: {
          name: 'review_candidate_evaluation',
          strict: true,
        },
      },
    });
    expect(
      reviewEvaluationProviderTokenUpperBound(evaluationInput),
    ).toBeGreaterThan(
      new TextEncoder().encode(JSON.stringify(request)).byteLength,
    );
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
