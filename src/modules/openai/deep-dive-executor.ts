import type { OpenAiConfiguration } from './configuration-store';
import { deepDiveProviderTokenUpperBound } from './openai-responses';
import type { DeepDiveResult } from '../reading-flow/deep-dive';
import type { Selection } from '../reading-flow/selection';
import {
  createAssistanceExecutor,
  type AssistanceExecutionDependencies,
  type AssistanceExecutionProgress,
} from './assistance-executor';

const deepDiveContractVersion = 'deep-dive-v1';
const maximumOutputTokensPerAttempt = 2_048;

export type DeepDiveExecutionInput = {
  apiKey: string;
  configuration: OpenAiConfiguration;
  selection: Selection;
};
export type DeepDiveExecutionDependencies = AssistanceExecutionDependencies<
  DeepDiveExecutionInput,
  DeepDiveResult
>;
export type DeepDiveExecutionProgress = AssistanceExecutionProgress;

export function deepDiveCacheKey(input: DeepDiveExecutionInput): string {
  return JSON.stringify({
    contract: deepDiveContractVersion,
    model: input.configuration.model.id,
    effort: input.configuration.efforts.deepDive,
    personalInstructions: input.configuration.personalInstructions,
    selection: input.selection,
  });
}

export function deepDiveTokenReservation(
  input: DeepDiveExecutionInput,
): number {
  return deepDiveProviderTokenUpperBound(input);
}

export function createDeepDiveExecutor(
  dependencies: DeepDiveExecutionDependencies,
): ReturnType<
  typeof createAssistanceExecutor<DeepDiveExecutionInput, DeepDiveResult>
> {
  return createAssistanceExecutor(
    {
      actionLabel: 'Deep Dive',
      maximumOutputTokensPerAttempt,
      cacheKey: deepDiveCacheKey,
      tokenReservation: deepDiveTokenReservation,
    },
    dependencies,
  );
}
