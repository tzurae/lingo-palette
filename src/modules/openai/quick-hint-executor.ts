import type { OpenAiConfiguration } from './configuration-store';
import {
  QUICK_HINT_MAXIMUM_OUTPUT_TOKENS,
  quickHintProviderTokenUpperBound,
} from './openai-responses';
import type { QuickHintResult } from '../reading-flow/quick-hint';
import type { Selection } from '../reading-flow/selection';
import {
  createAssistanceExecutor,
  type AssistanceExecutionDependencies,
  type AssistanceExecutionProgress,
} from './assistance-executor';

export {
  ASSISTANCE_FAILURE_KINDS,
  AssistanceFailure,
  type AssistanceFailureKind,
} from './assistance-executor';

const quickHintContractVersion = 'quick-hint-v1';

export type QuickHintExecutionInput = {
  apiKey: string;
  configuration: OpenAiConfiguration;
  selection: Selection;
};
export type QuickHintExecutionDependencies = AssistanceExecutionDependencies<
  QuickHintExecutionInput,
  QuickHintResult
>;
export type QuickHintExecutionProgress = AssistanceExecutionProgress;

export function quickHintCacheKey(input: QuickHintExecutionInput): string {
  return JSON.stringify({
    contract: quickHintContractVersion,
    model: input.configuration.model.id,
    effort: input.configuration.efforts.quickHint,
    personalInstructions: input.configuration.personalInstructions,
    selection: input.selection,
  });
}

export function quickHintTokenReservation(
  input: QuickHintExecutionInput,
): number {
  return quickHintProviderTokenUpperBound(input);
}

export function createQuickHintExecutor(
  dependencies: QuickHintExecutionDependencies,
): ReturnType<
  typeof createAssistanceExecutor<QuickHintExecutionInput, QuickHintResult>
> {
  return createAssistanceExecutor(
    {
      actionLabel: 'Quick Hint',
      maximumOutputTokensPerAttempt: QUICK_HINT_MAXIMUM_OUTPUT_TOKENS,
      cacheKey: quickHintCacheKey,
      tokenReservation: quickHintTokenReservation,
    },
    dependencies,
  );
}
