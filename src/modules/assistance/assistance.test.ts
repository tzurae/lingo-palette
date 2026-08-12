import { describe, expect, it } from 'vitest';
import { createAssistanceModule } from './assistance';
import { GenerationFailure, type GenerationPort } from './generation-port';
import type { BudgetPort } from './budget-port';
import type { RetryPort } from './retry-port';
import type { CachePort } from './cache-port';

const postponeSelection = {
  text: 'postpone',
  context: {
    before: 'The committee decided to ',
    after: ' the vote until next week.',
  },
};

const availableBudget: BudgetPort = {
  async reserve() {
    return { id: 'reservation' };
  },
  async settle() {},
  async release() {},
};

const immediateRetry: RetryPort = {
  async wait() {},
};

const emptyCache: CachePort = {
  async get() {
    return null;
  },
  async put() {},
};

describe('Assistance module', () => {
  it('returns a context-sensitive Quick Hint for a selection', async () => {
    const generation: GenerationPort = {
      async generate(request) {
        if (
          request.action.kind === 'quick-hint' &&
          request.selection.text === 'postpone' &&
          request.selection.context.after.includes('vote')
        ) {
          return {
            kind: 'quick-hint',
            simplerExpression: 'delay until a later time',
            explanationCue: '延後原本安排的事情',
            usage: { inputTokens: 32, outputTokens: 14 },
          };
        }

        throw new Error('The expected Selection and Reading Context were not supplied.');
      },
    };
    const assistance = createAssistanceModule({
      generation,
      budget: availableBudget,
      retry: immediateRetry,
      cache: emptyCache,
    });

    const outcome = await assistance.request({
      requestId: 'quick-hint-1',
      selection: postponeSelection,
      action: { kind: 'quick-hint' },
    });

    expect(outcome).toMatchObject({
      status: 'completed',
      action: { kind: 'quick-hint' },
      result: {
        kind: 'quick-hint',
        simplerExpression: 'delay until a later time',
        explanationCue: '延後原本安排的事情',
      },
      usage: { inputTokens: 32, outputTokens: 14 },
    });
    if (outcome.status !== 'completed') {
      throw new Error('Expected a completed Quick Hint.');
    }
    expect(outcome.requestId).toEqual(expect.any(String));
  });
  it('returns structured Deep Dive sections for the current Selection', async () => {
    const generation: GenerationPort = {
      async generate(request) {
        if (request.action.kind !== 'deep-dive') {
          throw new Error('Expected the Deep Dive Action.');
        }

        return {
          kind: 'deep-dive',
          contextualMeaning: '把原本安排好的事情延後到較晚時間',
          usageFit: '用於會議、投票、發布等原本已有安排的事件',
          grammarPattern: 'postpone + noun / postpone + verb-ing',
          alternatives: [
            {
              expression: 'delay',
              distinction: '也可表示非計畫性的延誤，語意範圍較廣',
            },
          ],
          examples: [
            'They postponed launching the product until next month.',
          ],
          usage: { inputTokens: 91, outputTokens: 73 },
        };
      },
    };
    const assistance = createAssistanceModule({
      generation,
      budget: availableBudget,
      retry: immediateRetry,
      cache: emptyCache,
    });

    const outcome = await assistance.request({
      requestId: 'deep-dive-1',
      selection: postponeSelection,
      action: { kind: 'deep-dive' },
    });

    expect(outcome).toMatchObject({
      status: 'completed',
      action: { kind: 'deep-dive' },
      result: {
        kind: 'deep-dive',
        contextualMeaning: '把原本安排好的事情延後到較晚時間',
        grammarPattern: 'postpone + noun / postpone + verb-ing',
      },
      usage: { inputTokens: 91, outputTokens: 73 },
    });
  });
  it('returns free-form Markdown for a learner-defined Custom Action', async () => {
    const generation: GenerationPort = {
      async generate(request) {
        if (
          request.action.kind !== 'custom' ||
          request.action.instructions !==
            'Compare this expression with one common alternative.'
        ) {
          throw new Error('Expected the learner-defined Custom Action.');
        }

        return {
          kind: 'custom',
          markdown:
            '**postpone** is intentional; **delay** may also describe an unplanned slowdown.',
          usage: { inputTokens: 47, outputTokens: 28 },
        };
      },
    };
    const assistance = createAssistanceModule({
      generation,
      budget: availableBudget,
      retry: immediateRetry,
      cache: emptyCache,
    });

    const outcome = await assistance.request({
      requestId: 'custom-1',
      selection: postponeSelection,
      action: {
        kind: 'custom',
        id: 'compare-alternative',
        name: 'Compare alternatives',
        instructions: 'Compare this expression with one common alternative.',
      },
    });

    expect(outcome).toMatchObject({
      status: 'completed',
      action: { kind: 'custom', id: 'compare-alternative' },
      result: {
        kind: 'custom',
        markdown:
          '**postpone** is intentional; **delay** may also describe an unplanned slowdown.',
      },
      usage: { inputTokens: 47, outputTokens: 28 },
    });
  });
  it('does not generate when the hard daily budget cannot reserve the request', async () => {
    const generation: GenerationPort = {
      async generate() {
        throw new Error('Generation must not run after budget exhaustion.');
      },
    };
    const budget: BudgetPort = {
      async reserve() {
        return null;
      },
      async settle() {
        throw new Error('An absent reservation cannot be settled.');
      },
      async release() {
        throw new Error('An absent reservation cannot be released.');
      },
    };
    const assistance = createAssistanceModule({
      generation,
      budget,
      retry: immediateRetry,
      cache: emptyCache,
    });

    const outcome = await assistance.request({
      requestId: 'budget-1',
      selection: postponeSelection,
      action: { kind: 'quick-hint' },
    });

    expect(outcome).toEqual({
      status: 'failed',
      action: { kind: 'quick-hint' },
      error: {
        kind: 'budget-exhausted',
        message: '今日的 Lingo Palette 使用預算已用完。',
        retryable: false,
      },
    });
  });
  it('retries a temporary provider failure twice before returning the result', async () => {
    let attempts = 0;
    const generation: GenerationPort = {
      async generate() {
        attempts += 1;
        if (attempts < 3) {
          throw new GenerationFailure({
            kind: 'rate-limited',
            message: 'Too many requests',
            retryable: true,
            retryAfterMs: 25,
          });
        }

        return {
          kind: 'quick-hint',
          simplerExpression: 'delay until a later time',
          explanationCue: null,
          usage: { inputTokens: 32, outputTokens: 11 },
        };
      },
    };
    const assistance = createAssistanceModule({
      generation,
      budget: availableBudget,
      retry: immediateRetry,
      cache: emptyCache,
    });

    const outcome = await assistance.request({
      requestId: 'retry-1',
      selection: postponeSelection,
      action: { kind: 'quick-hint' },
    });

    expect(outcome).toMatchObject({
      status: 'completed',
      result: {
        kind: 'quick-hint',
        simplerExpression: 'delay until a later time',
      },
    });
    expect(attempts).toBe(3);
  });
  it('returns a cached result without reserving budget or calling the provider', async () => {
    const cache: CachePort = {
      async get() {
        return {
          kind: 'quick-hint',
          simplerExpression: 'delay until a later time',
          explanationCue: null,
        };
      },
      async put() {
        throw new Error('An existing cached result must not be replaced.');
      },
    };
    const generation: GenerationPort = {
      async generate() {
        throw new Error('A cache hit must not call the provider.');
      },
    };
    const budget: BudgetPort = {
      async reserve() {
        throw new Error('A cache hit must not reserve budget.');
      },
      async settle() {
        throw new Error('A cache hit has no reservation to settle.');
      },
      async release() {
        throw new Error('A cache hit has no reservation to release.');
      },
    };
    const assistance = createAssistanceModule({
      generation,
      budget,
      retry: immediateRetry,
      cache,
    });

    const outcome = await assistance.request({
      requestId: 'cache-1',
      selection: postponeSelection,
      action: { kind: 'quick-hint' },
    });

    expect(outcome).toMatchObject({
      status: 'completed',
      source: 'cache',
      result: {
        kind: 'quick-hint',
        simplerExpression: 'delay until a later time',
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });
  it('cancels an in-flight request and releases its budget reservation', async () => {
    let released = false;
    const started = Promise.withResolvers<void>();
    const generation: GenerationPort = {
      async generate(_request, signal) {
        started.resolve();
        const { promise, reject } = Promise.withResolvers<never>();
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return await promise;
        }

        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
        return await promise;
      },
    };
    const budget: BudgetPort = {
      async reserve() {
        return { id: 'cancelled-reservation' };
      },
      async settle() {
        throw new Error('A cancelled request cannot be settled.');
      },
      async release() {
        released = true;
      },
    };
    const assistance = createAssistanceModule({
      generation,
      budget,
      retry: immediateRetry,
      cache: emptyCache,
    });

    const pending = assistance.request({
      requestId: 'selection-1',
      selection: postponeSelection,
      action: { kind: 'quick-hint' },
    });
    await started.promise;
    assistance.cancel('selection-1');

    await expect(pending).resolves.toEqual({
      status: 'failed',
      action: { kind: 'quick-hint' },
      error: {
        kind: 'cancelled',
        message: '已取消查詢。',
        retryable: false,
      },
    });
    expect(released).toBe(true);
  });
});
