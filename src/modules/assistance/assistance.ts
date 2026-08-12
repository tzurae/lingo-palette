import type { BudgetPort } from './budget-port';
import type { CachePort, CachedGeneration } from './cache-port';
import {
  GenerationFailure,
  type Action,
  type Generation,
  type GenerationPort,
  type GenerationRequest,
  type Selection,
  type TokenUsage,
} from './generation-port';
import type { RetryPort } from './retry-port';

export type AssistanceRequest = {
  requestId: string;
  selection: Selection;
  action: Action;
};

export type CompletedAssistance = {
  status: 'completed';
  requestId: string;
  action: Action;
  result: CachedGeneration;
  source: 'provider' | 'cache';
  usage: TokenUsage;
};

export type FailedAssistance = {
  status: 'failed';
  action: Action;
  error: {
    kind: 'budget-exhausted' | 'cancelled';
    message: string;
    retryable: false;
  };
};

export type AssistanceOutcome = CompletedAssistance | FailedAssistance;

export interface AssistanceModule {
  request(request: AssistanceRequest): Promise<AssistanceOutcome>;
  cancel(requestId: string): void;
}

type AssistanceDependencies = {
  generation: GenerationPort;
  budget: BudgetPort;
  retry: RetryPort;
  cache: CachePort;
};

export function createAssistanceModule(
  dependencies: AssistanceDependencies,
): AssistanceModule {
  const controllers = new Map<string, AbortController>();

  return {
    async request(request) {
      const controller = new AbortController();
      controllers.set(request.requestId, controller);

      try {
        return await executeRequest(
          dependencies,
          request,
          controller.signal,
        );
      } finally {
        if (controllers.get(request.requestId) === controller) {
          controllers.delete(request.requestId);
        }
      }
    },
    cancel(requestId) {
      controllers.get(requestId)?.abort();
    },
  };
}

async function executeRequest(
  dependencies: AssistanceDependencies,
  request: AssistanceRequest,
  signal: AbortSignal,
): Promise<AssistanceOutcome> {
  const generationRequest: GenerationRequest = {
    selection: request.selection,
    action: request.action,
  };
  const cached = await dependencies.cache.get(generationRequest);

  if (signal.aborted) {
    return {
      status: 'failed',
      action: request.action,
      error: {
        kind: 'cancelled',
        message: '已取消查詢。',
        retryable: false,
      },
    };
  }

  if (cached !== null) {
    return {
      status: 'completed',
      requestId: request.requestId,
      action: request.action,
      result: cached,
      source: 'cache',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const reservation = await dependencies.budget.reserve(generationRequest);

  if (reservation === null) {
    return {
      status: 'failed',
      action: request.action,
      error: {
        kind: 'budget-exhausted',
        message: '今日的 Lingo Palette 使用預算已用完。',
        retryable: false,
      },
    };
  }

  if (signal.aborted) {
    await dependencies.budget.release(reservation);
    return {
      status: 'failed',
      action: request.action,
      error: {
        kind: 'cancelled',
        message: '已取消查詢。',
        retryable: false,
      },
    };
  }

  let generation: Generation;
  let retries = 0;

  try {
    while (true) {
      try {
        generation = await dependencies.generation.generate(
          generationRequest,
          signal,
        );
        break;
      } catch (error) {
        if (
          signal.aborted ||
          !(error instanceof GenerationFailure) ||
          !error.retryable ||
          retries >= 2
        ) {
          throw error;
        }

        retries += 1;
        await dependencies.retry.wait(
          error.retryAfterMs === undefined
            ? { attempt: retries }
            : { attempt: retries, retryAfterMs: error.retryAfterMs },
          signal,
        );
      }
    }
  } catch (error) {
    await dependencies.budget.release(reservation);
    if (signal.aborted) {
      return {
        status: 'failed',
        action: request.action,
        error: {
          kind: 'cancelled',
          message: '已取消查詢。',
          retryable: false,
        },
      };
    }
    throw error;
  }

  const { usage, ...result } = generation;
  await dependencies.budget.settle(reservation, usage);
  await dependencies.cache.put(generationRequest, result);

  return {
    status: 'completed',
    requestId: request.requestId,
    action: request.action,
    result,
    source: 'provider',
    usage,
  };
}
