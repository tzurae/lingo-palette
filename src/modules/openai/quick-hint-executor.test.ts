import { describe, expect, it } from 'vitest';
import type { ProviderUsage } from './budget-ledger';
import type { OpenAiConfiguration } from './configuration-store';
import type { QuickHintResult } from '../reading-flow/quick-hint';
import {
  AssistanceFailure,
  createQuickHintExecutor,
  quickHintCacheKey,
  quickHintTokenReservation,
  type QuickHintExecutionDependencies,
} from './quick-hint-executor';

const configuration: OpenAiConfiguration = {
  model: { kind: 'curated', id: 'gpt-5.4-mini-2026-03-17' },
  efforts: { quickHint: 'low', deepDive: 'medium', review: 'medium' },
  personalInstructions: '',
};
const request = {
  apiKey: 'sk-test',
  configuration,
  selection: {
    text: 'postpone',
    context: { before: 'decided to ', after: ' the vote' },
  },
};
const usage: ProviderUsage = {
  inputTokens: 120,
  cachedInputTokens: 20,
  outputTokens: 30,
  reasoningTokens: 10,
  totalTokens: 150,
  estimatedCostUsd: 0.00021,
};
const result = {
  simplerExpression: 'delay until later',
  explanationCue: '延後處理',
};

function dependencies(
  overrides: Partial<QuickHintExecutionDependencies> = {},
): QuickHintExecutionDependencies & {
  events: string[];
  cacheValues: Map<string, QuickHintResult>;
} {
  const events: string[] = [];
  const cacheValues = new Map<string, QuickHintResult>();
  let reservation = 0;
  return {
    events,
    cacheValues,
    isOnline: () => true,
    cache: {
      async get(key) {
        events.push(`cache:get:${key}`);
        return cacheValues.get(key) ?? null;
      },
      async put(key, value) {
        events.push(`cache:put:${key}`);
        cacheValues.set(key, value);
      },
    },
    budget: {
      async reserve() {
        events.push('budget:reserve');
        reservation += 1;
        return {
          status: 'reserved',
          reservation: {
            id: `r-${reservation}`,
            activeDate: '2026-08-13',
            tokens: 8_192,
            estimatedCostUsd: 0.01,
          },
        };
      },
      async reconcile(current, reported) {
        events.push(`budget:reconcile:${current.id}:${reported.totalTokens}`);
      },
      async release(current) {
        events.push(`budget:release:${current.id}`);
      },
    },
    provider: {
      async generate(_input, _signal) {
        events.push('provider:generate');
        return { result, usage };
      },
    },
    wait: async (delay) => {
      events.push(`wait:${delay}`);
    },
    random: () => 0,
    ...overrides,
  };
}

describe('Quick Hint assistance executor', () => {
  it('returns a cache hit offline before provider availability or budget', async () => {
    const deps = dependencies({ isOnline: () => false });
    deps.cacheValues.set(quickHintCacheKey(request), result);
    const executor = createQuickHintExecutor(deps);

    await expect(executor.execute(request)).resolves.toEqual({
      source: 'cache',
      result,
      usage: null,
      attempts: 0,
    });
    expect(deps.events).toEqual([
      `cache:get:${quickHintCacheKey(request)}`,
    ]);
  });

  it('allows a keyless cache hit but rejects a keyless miss before budget or provider work', async () => {
    const keylessRequest = { ...request, apiKey: '' };
    const deps = dependencies();
    deps.cacheValues.set(quickHintCacheKey(keylessRequest), result);

    await expect(
      createQuickHintExecutor(deps).execute(keylessRequest),
    ).resolves.toMatchObject({ source: 'cache', result });
    deps.cacheValues.clear();
    deps.events.length = 0;

    await expect(
      createQuickHintExecutor(deps).execute(keylessRequest),
    ).rejects.toMatchObject({
      kind: 'authentication',
      retryable: false,
    });
    expect(deps.events).toEqual([
      `cache:get:${quickHintCacheKey(keylessRequest)}`,
    ]);
  });

  it('fails offline on a cache miss without reserving or calling the provider', async () => {
    const deps = dependencies({ isOnline: () => false });
    const executor = createQuickHintExecutor(deps);

    await expect(executor.execute(request)).rejects.toMatchObject({
      kind: 'offline',
      retryable: true,
    });
    expect(deps.events).toEqual([
      `cache:get:${quickHintCacheKey(request)}`,
    ]);
  });

  it('reserves before a provider call, reconciles detailed usage, then caches the result', async () => {
    const deps = dependencies();
    const executor = createQuickHintExecutor(deps);

    await expect(executor.execute(request)).resolves.toEqual({
      source: 'provider',
      result,
      usage,
      attempts: 1,
    });
    expect(deps.events).toEqual([
      `cache:get:${quickHintCacheKey(request)}`,
      'budget:reserve',
      'provider:generate',
      'budget:reconcile:r-1:150',
      `cache:put:${quickHintCacheKey(request)}`,
    ]);
  });

  it('reserves a byte-safe upper bound for the exact bounded request', async () => {
    let reservation:
      | { tokens: number; estimatedCostUsd: number | null }
      | undefined;
    const worstCaseRequest = {
      ...request,
      configuration: {
        ...configuration,
        personalInstructions: '😀'.repeat(4_000),
      },
      selection: {
        text: '😀'.repeat(4_000),
        context: {
          before: '😀'.repeat(2_000),
          after: '😀'.repeat(2_000),
        },
      },
    };
    const deps = dependencies({
      budget: {
        async reserve(current) {
          reservation = current;
          return {
            status: 'reserved',
            reservation: {
              id: 'bounded',
              activeDate: '2026-08-13',
              tokens: current.tokens,
              estimatedCostUsd: current.estimatedCostUsd,
            },
          };
        },
        async reconcile() {},
        async release() {},
      },
    });

    await createQuickHintExecutor(deps).execute(worstCaseRequest);

    expect(reservation?.tokens).toBe(
      quickHintTokenReservation(worstCaseRequest),
    );
    expect(reservation?.tokens).toBeGreaterThan(8_192);
  });

  it('returns a paid provider result when best-effort cache persistence fails', async () => {
    const deps = dependencies({
      cache: {
        async get() {
          return null;
        },
        async put() {
          throw new Error('storage quota exceeded');
        },
      },
    });

    await expect(createQuickHintExecutor(deps).execute(request)).resolves.toMatchObject({
      source: 'provider',
      result,
      usage,
    });
    expect(deps.events).toContain('budget:reconcile:r-1:150');
  });

  it('retries eligible foreground failures at most twice and honors Retry-After', async () => {
    let attempt = 0;
    const deps = dependencies({
      provider: {
        async generate() {
          attempt += 1;
          deps.events.push(`provider:generate:${attempt}`);
          if (attempt < 3) {
            throw new AssistanceFailure({
              kind: 'rate-limit',
              message: 'Temporary rate limit',
              retryable: true,
              retryAfterMs: 1_500,
            });
          }
          return { result, usage };
        },
      },
    });
    const executor = createQuickHintExecutor(deps);

    await expect(executor.execute(request)).resolves.toMatchObject({
      attempts: 3,
      source: 'provider',
    });
    expect(deps.events.filter((event) => event === 'wait:1500')).toHaveLength(2);
    expect(deps.events.filter((event) => event.startsWith('budget:reserve'))).toHaveLength(3);
    expect(deps.events.filter((event) => event.startsWith('budget:release'))).toHaveLength(2);
  });

  it('uses bounded jittered backoff when Retry-After is absent', async () => {
    let attempt = 0;
    const deps = dependencies({
      random: () => 1,
      provider: {
        async generate() {
          attempt += 1;
          if (attempt < 3) {
            throw new AssistanceFailure({
              kind: 'server',
              message: 'Temporary 503',
              retryable: true,
            });
          }
          return { result, usage };
        },
      },
    });

    await createQuickHintExecutor(deps).execute(request);

    expect(deps.events).toContain('wait:750');
    expect(deps.events).toContain('wait:1500');
  });

  it.each([
    'authentication',
    'permission',
    'malformed-request',
    'provider-credit',
    'provider-quota',
    'spend-limit',
  ] as const)('does not retry terminal %s failures', async (kind) => {
    const deps = dependencies({
      provider: {
        async generate() {
          deps.events.push('provider:terminal');
          throw new AssistanceFailure({
            kind,
            message: `terminal ${kind}`,
            retryable: false,
          });
        },
      },
    });

    await expect(createQuickHintExecutor(deps).execute(request)).rejects.toMatchObject({ kind });
    expect(deps.events.filter((event) => event === 'provider:terminal')).toHaveLength(1);
    expect(deps.events.filter((event) => event.startsWith('wait:'))).toHaveLength(0);
  });

  it('reports a local-budget failure without calling the provider', async () => {
    const deps = dependencies({
      budget: {
        async reserve() {
          deps.events.push('budget:blocked');
          return { status: 'blocked', kind: 'token-budget' };
        },
        async reconcile() {
          throw new Error('No reservation to reconcile.');
        },
        async release() {
          throw new Error('No reservation to release.');
        },
      },
    });

    await expect(createQuickHintExecutor(deps).execute(request)).rejects.toMatchObject({
      kind: 'local-budget',
      retryable: false,
    });
    expect(deps.events).not.toContain('provider:generate');
  });

  it('cancels provider work and releases an unused reservation', async () => {
    let observedSignal: AbortSignal | undefined;
    const started = Promise.withResolvers<void>();
    const deps = dependencies({
      provider: {
        async generate(_input, signal) {
          observedSignal = signal;
          started.resolve();
          if (signal.aborted) {
            throw new AssistanceFailure({
              kind: 'cancelled',
              message: 'Cancelled',
              retryable: false,
            });
          }
          const deferred = Promise.withResolvers<never>();
          signal.addEventListener('abort', () => {
            deferred.reject(
              new AssistanceFailure({
                kind: 'cancelled',
                message: 'Cancelled',
                retryable: false,
              }),
            );
          });
          return deferred.promise;
        },
      },
    });
    const controller = new AbortController();
    const execution = createQuickHintExecutor(deps).execute(request, controller.signal);
    await started.promise;
    controller.abort();

    await expect(execution).rejects.toMatchObject({ kind: 'cancelled' });
    expect(observedSignal?.aborted).toBe(true);
    expect(deps.events).toContain('budget:release:r-1');
  });

  it('reconciles failed-attempt reported usage instead of releasing it', async () => {
    const failedUsage: ProviderUsage = { ...usage, totalTokens: 75 };
    const deps = dependencies({
      provider: {
        async generate() {
          throw new AssistanceFailure({
            kind: 'provider-quota',
            message: 'Quota exhausted',
            retryable: false,
            usage: failedUsage,
          });
        },
      },
    });

    await expect(createQuickHintExecutor(deps).execute(request)).rejects.toMatchObject({
      kind: 'provider-quota',
    });
    expect(deps.events).toContain('budget:reconcile:r-1:75');
    expect(deps.events).not.toContain('budget:release:r-1');
  });

  it('keeps cache identity tied to exact model, effort, instructions, selection, and contract version', () => {
    const base = quickHintCacheKey(request);
    expect(
      quickHintCacheKey({
        ...request,
        configuration: {
          ...configuration,
          efforts: { ...configuration.efforts, quickHint: 'high' },
        },
      }),
    ).not.toBe(base);
    expect(
      quickHintCacheKey({
        ...request,
        configuration: { ...configuration, personalInstructions: 'Be brief.' },
      }),
    ).not.toBe(base);
  });
});
