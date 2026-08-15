import {
  createAssistanceExecutor,
  type AssistanceExecutionDependencies,
  type AssistanceExecutionInput,
  type AssistanceExecutionProgress,
} from '../openai/assistance-executor';
import type { ProviderUsage } from '../openai/budget-ledger';
import { estimateOpenAiSpeechCost } from '../openai/pricing';
import {
  pronunciationInstructions,
  type PronunciationVariety,
  type RemoteAudio,
} from './playback';

export const OPENAI_SPEECH_MODEL = 'gpt-4o-mini-tts-2025-12-15';
export const OPENAI_SPEECH_VOICE = 'cedar';
export const MAXIMUM_SPEECH_OUTPUT_TOKENS_PER_CHUNK = 32_000;

export type PronunciationExecutionInput = AssistanceExecutionInput & {
  variety: PronunciationVariety;
};

export type PronunciationExecutionDependencies =
  AssistanceExecutionDependencies<PronunciationExecutionInput, RemoteAudio> & {
    countTokens(text: string): number;
  };

export type PronunciationExecutionOutcome = {
  source: 'cache' | 'provider';
  result: RemoteAudio;
  usage: ProviderUsage | null;
  attempts: number;
};

export type PronunciationExecutor = {
  execute(
    input: PronunciationExecutionInput,
    signal?: AbortSignal,
    onRetry?: (progress: AssistanceExecutionProgress) => void,
  ): Promise<PronunciationExecutionOutcome>;
};

export function createPronunciationExecutor(
  dependencies: PronunciationExecutionDependencies,
): PronunciationExecutor {
  return createAssistanceExecutor<PronunciationExecutionInput, RemoteAudio>(
    {
      actionLabel: 'AI Pronunciation Playback',
      maximumOutputTokensPerAttempt:
        MAXIMUM_SPEECH_OUTPUT_TOKENS_PER_CHUNK,
      cacheKey: pronunciationCacheKey,
      tokenReservation(input) {
        return estimatedSpeechUsage(input, dependencies.countTokens).totalTokens;
      },
      estimatedCostUsd(input) {
        const usage = estimatedSpeechUsage(input, dependencies.countTokens);
        return estimateOpenAiSpeechCost(usage);
      },
    },
    dependencies,
  );
}

export function pronunciationCacheKey(
  input: Pick<PronunciationExecutionInput, 'selection' | 'variety'>,
): string {
  return JSON.stringify([
    OPENAI_SPEECH_MODEL,
    OPENAI_SPEECH_VOICE,
    input.variety,
    input.selection.text,
  ]);
}


function estimatedSpeechUsage(
  input: PronunciationExecutionInput,
  countTokens: (text: string) => number,
): Pick<ProviderUsage, 'inputTokens' | 'outputTokens' | 'totalTokens'> {
  const inputTokens = countTokens(
    `${pronunciationInstructions(input.variety)}\n${input.selection.text}`,
  );
  const outputTokens = MAXIMUM_SPEECH_OUTPUT_TOKENS_PER_CHUNK;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}
