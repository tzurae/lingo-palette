import type { ProviderUsage } from './budget-ledger';

export const OPENAI_PRICING_CHECKED_DATE = '2026-08-13';
export const OPENAI_USAGE_DASHBOARD_URL =
  'https://platform.openai.com/usage';

export type OpenAiTextPricing = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};
export type OpenAiSpeechPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export const OPENAI_SPEECH_PRICING: OpenAiSpeechPricing = {
  inputUsdPerMillion: 0.6,
  outputUsdPerMillion: 12,
};


const pricingByModel: Record<string, OpenAiTextPricing> = {
  'gpt-5.4-mini-2026-03-17': {
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
  'gpt-5.4-nano-2026-03-17': {
    inputUsdPerMillion: 0.2,
    cachedInputUsdPerMillion: 0.02,
    outputUsdPerMillion: 1.25,
  },
};

export function pricingForModel(model: string): OpenAiTextPricing | null {
  return pricingByModel[model] ?? null;
}

export function estimateOpenAiCost(
  model: string,
  usage: Omit<ProviderUsage, 'estimatedCostUsd'>,
): number | null {
  const pricing = pricingForModel(model);
  if (pricing === null) return null;
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens,
  );
  return (
    uncachedInputTokens * (pricing.inputUsdPerMillion / 1_000_000) +
    usage.cachedInputTokens *
      (pricing.cachedInputUsdPerMillion / 1_000_000) +
    usage.outputTokens * (pricing.outputUsdPerMillion / 1_000_000)
  );
}

export function estimateOpenAiSpeechCost(usage: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return (
    usage.inputTokens *
      (OPENAI_SPEECH_PRICING.inputUsdPerMillion / 1_000_000) +
    usage.outputTokens *
      (OPENAI_SPEECH_PRICING.outputUsdPerMillion / 1_000_000)
  );
}

export function pricingIsStale(now: Date): boolean {
  const checkedAt = new Date(`${OPENAI_PRICING_CHECKED_DATE}T00:00:00Z`);
  const staleAfterDays = 90;
  return now.getTime() - checkedAt.getTime() > staleAfterDays * 86_400_000;
}
