import type {
  BudgetReservation,
  ProviderUsage,
} from './budget-ledger';
import type { OpenAiConfiguration } from './configuration-store';
import { estimateOpenAiCost } from './pricing';
import type { Selection } from '../reading-flow/selection';

const maximumForegroundAttempts = 3;

export const ASSISTANCE_FAILURE_KINDS = [
  'offline',
  'connection',
  'timeout',
  'rate-limit',
  'server',
  'authentication',
  'permission',
  'malformed-request',
  'provider-credit',
  'provider-quota',
  'spend-limit',
  'local-budget',
  'cancelled',
  'incompatible',
  'provider-unavailable',
] as const;
export type AssistanceFailureKind =
  (typeof ASSISTANCE_FAILURE_KINDS)[number];

export class AssistanceFailure extends Error {
  readonly kind: AssistanceFailureKind;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly usage: ProviderUsage | undefined;
  readonly budgetKind:
    | 'provider-disabled'
    | 'token-budget'
    | 'estimated-cost-budget'
    | undefined;

  constructor(details: {
    kind: AssistanceFailureKind;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    usage?: ProviderUsage;
    budgetKind?:
      | 'provider-disabled'
      | 'token-budget'
      | 'estimated-cost-budget';
  }) {
    super(details.message);
    this.name = 'AssistanceFailure';
    this.kind = details.kind;
    this.retryable = details.retryable;
    this.retryAfterMs = details.retryAfterMs;
    this.usage = details.usage;
    this.budgetKind = details.budgetKind;
  }
}

export type AssistanceExecutionInput = {
  apiKey: string;
  configuration: OpenAiConfiguration;
  selection: Selection;
};

export type AssistanceExecutionDependencies<
  Input extends AssistanceExecutionInput,
  Result,
> = {
  isOnline(): boolean | Promise<boolean>;
  cache: {
    get(key: string): Promise<Result | null>;
    put(key: string, value: Result): Promise<void>;
  };
  budget: {
    reserve(request: {
      tokens: number;
      estimatedCostUsd: number | null;
    }): Promise<
      | { status: 'reserved'; reservation: BudgetReservation }
      | {
          status: 'blocked';
          kind:
            | 'provider-disabled'
            | 'token-budget'
            | 'estimated-cost-budget';
        }
    >;
    reconcile(
      reservation: BudgetReservation,
      usage: ProviderUsage,
    ): Promise<void>;
    release(reservation: BudgetReservation): Promise<void>;
  };
  provider: {
    generate(
      input: Input,
      signal: AbortSignal,
    ): Promise<{ result: Result; usage: ProviderUsage }>;
  };
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
  random(): number;
};

export type AssistanceExecutionProgress = {
  kind: AssistanceFailureKind;
  completedAttempts: number;
  nextAttempt: number;
  delayMs: number;
};

type AssistanceExecutionContract<Input extends AssistanceExecutionInput> = {
  actionLabel: string;
  maximumOutputTokensPerAttempt: number;
  cacheKey(input: Input): string;
  tokenReservation(input: Input): number;
  estimatedCostUsd?(input: Input): number | null;
};

export function createAssistanceExecutor<
  Input extends AssistanceExecutionInput,
  Result,
>(
  contract: AssistanceExecutionContract<Input>,
  dependencies: AssistanceExecutionDependencies<Input, Result>,
): {
  execute(
    input: Input,
    signal?: AbortSignal,
    onRetry?: (progress: AssistanceExecutionProgress) => void,
  ): Promise<{
    source: 'cache' | 'provider';
    result: Result;
    usage: ProviderUsage | null;
    attempts: number;
  }>;
} {
  return {
    async execute(input, externalSignal, onRetry) {
      const signal = externalSignal ?? new AbortController().signal;
      const cacheKey = contract.cacheKey(input);
      const cached = await dependencies.cache.get(cacheKey);
      if (cached !== null) {
        return { source: 'cache', result: cached, usage: null, attempts: 0 };
      }
      if (input.apiKey.length === 0) {
        throw new AssistanceFailure({
          kind: 'authentication',
          message: '請先到 Lingo Palette Settings 儲存 OpenAI API key。',
          retryable: false,
        });
      }
      if (signal.aborted) throw cancellationFailure(contract.actionLabel);
      if (!(await dependencies.isOnline())) {
        throw new AssistanceFailure({
          kind: 'offline',
          message: `目前離線；此內容沒有可用的 ${contract.actionLabel} 快取。連線後可重試。`,
          retryable: true,
        });
      }

      let attempts = 0;
      while (attempts < maximumForegroundAttempts) {
        if (signal.aborted) throw cancellationFailure(contract.actionLabel);
        const maximumProviderTokensPerAttempt =
          contract.tokenReservation(input);
        const estimatedCostUsd =
          contract.estimatedCostUsd?.(input) ??
          estimateOpenAiCost(input.configuration.model.id, {
            inputTokens:
              maximumProviderTokensPerAttempt -
              contract.maximumOutputTokensPerAttempt,
            cachedInputTokens: 0,
            outputTokens: contract.maximumOutputTokensPerAttempt,
            reasoningTokens: contract.maximumOutputTokensPerAttempt,
            totalTokens: maximumProviderTokensPerAttempt,
          });
        const reserved = await dependencies.budget.reserve({
          tokens: maximumProviderTokensPerAttempt,
          estimatedCostUsd,
        });
        if (reserved.status === 'blocked') {
          throw new AssistanceFailure({
            kind: 'local-budget',
            message: budgetFailureMessage(
              reserved.kind,
              contract.actionLabel,
            ),
            retryable: false,
            budgetKind: reserved.kind,
          });
        }

        attempts += 1;
        try {
          const generated = await dependencies.provider.generate(input, signal);
          await dependencies.budget.reconcile(
            reserved.reservation,
            generated.usage,
          );
          try {
            await dependencies.cache.put(cacheKey, generated.result);
          } catch {
            // A paid result remains usable when optional cache storage fails.
          }
          return {
            source: 'provider',
            result: generated.result,
            usage: generated.usage,
            attempts,
          };
        } catch (error) {
          const failure = normalizeFailure(error, signal, contract.actionLabel);
          await settleFailedAttempt(
            dependencies,
            reserved.reservation,
            failure,
          );
          if (!failure.retryable || signal.aborted) throw failure;
          if (attempts >= maximumForegroundAttempts) {
            throw new AssistanceFailure({
              kind: failure.kind,
              message: `${failure.message} Foreground retry 已用完 ${attempts} 次；Selection 已保留，可稍後重試。`,
              retryable: true,
            });
          }
          const retryNumber = attempts - 1;
          const delay =
            failure.retryAfterMs ??
            Math.min(
              5_000,
              500 * 2 ** retryNumber * (1 + dependencies.random() * 0.5),
            );
          onRetry?.({
            kind: failure.kind,
            completedAttempts: attempts,
            nextAttempt: attempts + 1,
            delayMs: delay,
          });
          try {
            await dependencies.wait(delay, signal);
          } catch {
            throw cancellationFailure(contract.actionLabel);
          }
        }
      }
      throw new AssistanceFailure({
        kind: 'provider-unavailable',
        message: 'OpenAI foreground retry 次數已用完；Selection 已保留，可稍後重試。',
        retryable: true,
      });
    },
  };
}

async function settleFailedAttempt<
  Input extends AssistanceExecutionInput,
  Result,
>(
  dependencies: AssistanceExecutionDependencies<Input, Result>,
  reservation: BudgetReservation,
  failure: AssistanceFailure,
): Promise<void> {
  if (failure.usage === undefined) {
    await dependencies.budget.release(reservation);
    return;
  }
  await dependencies.budget.reconcile(reservation, failure.usage);
}

function normalizeFailure(
  error: unknown,
  signal: AbortSignal,
  actionLabel: string,
): AssistanceFailure {
  if (signal.aborted) return cancellationFailure(actionLabel);
  if (error instanceof AssistanceFailure) return error;
  return new AssistanceFailure({
    kind: 'provider-unavailable',
    message: error instanceof Error ? error.message : 'OpenAI request failed.',
    retryable: false,
  });
}

function cancellationFailure(actionLabel: string): AssistanceFailure {
  return new AssistanceFailure({
    kind: 'cancelled',
    message: `已取消 ${actionLabel}；Selection 仍保留。`,
    retryable: false,
  });
}

function budgetFailureMessage(
  kind: 'provider-disabled' | 'token-budget' | 'estimated-cost-budget',
  actionLabel: string,
): string {
  if (kind === 'provider-disabled') {
    return 'OpenAI provider Actions 已由每日上限 0 明確停用。';
  }
  if (kind === 'token-budget') {
    return `今日的 provider token hard limit 已無法預留這次 ${actionLabel}。`;
  }
  return `今日的 estimated-cost hard limit 已無法預留這次 ${actionLabel}。`;
}
