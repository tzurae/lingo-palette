import { describe, expect, it } from 'vitest';
import type { ProviderUsage } from './budget-ledger';
import type { OpenAiConfiguration } from './configuration-store';
import type { DeepDiveResult } from '../reading-flow/deep-dive';
import {
  createDeepDiveExecutor,
  deepDiveCacheKey,
  deepDiveTokenReservation,
  type DeepDiveExecutionDependencies,
} from './deep-dive-executor';

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
  inputTokens: 400,
  cachedInputTokens: 50,
  outputTokens: 300,
  reasoningTokens: 100,
  totalTokens: 700,
  estimatedCostUsd: 0.001,
};
const result: DeepDiveResult = {
  contextualMeaning: 'Decide that the vote will happen later.',
  usageFit: 'Neutral and suitable for a committee decision.',
  grammarPattern: {
    pattern: 'postpone + noun',
    explanation: 'The noun names the delayed event.',
  },
  alternatives: [
    { expression: 'put off', distinction: 'More conversational.' },
  ],
  examples: [
    {
      sentence: 'The committee postponed the vote.',
      explanation: 'The vote is the delayed event.',
    },
  ],
};

function dependencies(): DeepDiveExecutionDependencies & {
  events: string[];
  cacheValues: Map<string, DeepDiveResult>;
} {
  const events: string[] = [];
  const cacheValues = new Map<string, DeepDiveResult>();
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
      async reserve(current) {
        events.push(`budget:reserve:${current.tokens}`);
        return {
          status: 'reserved',
          reservation: {
            id: 'deep-1',
            activeDate: '2026-08-13',
            tokens: current.tokens,
            estimatedCostUsd: current.estimatedCostUsd,
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
      async generate() {
        events.push('provider:generate');
        return { result, usage };
      },
    },
    wait: async (delay) => {
      events.push(`wait:${delay}`);
    },
    random: () => 0,
  };
}

describe('Deep Dive assistance executor', () => {
  it('reserves its bounded request, reconciles usage, and caches by exact selection', async () => {
    const deps = dependencies();

    await expect(createDeepDiveExecutor(deps).execute(request)).resolves.toEqual({
      source: 'provider',
      result,
      usage,
      attempts: 1,
    });

    expect(deps.events).toEqual([
      `cache:get:${deepDiveCacheKey(request)}`,
      `budget:reserve:${deepDiveTokenReservation(request)}`,
      'provider:generate',
      'budget:reconcile:deep-1:700',
      `cache:put:${deepDiveCacheKey(request)}`,
    ]);
    expect(deepDiveCacheKey(request)).not.toBe(
      deepDiveCacheKey({
        ...request,
        selection: { ...request.selection, text: 'delay' },
      }),
    );
  });

  it('returns an exact cache hit while offline without budget or provider work', async () => {
    const deps = dependencies();
    deps.cacheValues.set(deepDiveCacheKey(request), result);
    deps.isOnline = () => false;

    await expect(createDeepDiveExecutor(deps).execute(request)).resolves.toMatchObject({
      source: 'cache',
      result,
      attempts: 0,
    });
    expect(deps.events).toEqual([`cache:get:${deepDiveCacheKey(request)}`]);
  });
});
