import { describe, expect, it } from 'vitest';
import {
  OPENAI_PRICING_CHECKED_DATE,
  estimateOpenAiCost,
  estimateOpenAiSpeechCost,
  pricingForModel,
  pricingIsStale,
} from './pricing';

describe('packaged OpenAI pricing', () => {
  it('prices curated input, cached input, and reasoning/output tokens', () => {
    expect(pricingForModel('gpt-5.4-mini-2026-03-17')).toEqual({
      inputUsdPerMillion: 0.75,
      cachedInputUsdPerMillion: 0.075,
      outputUsdPerMillion: 4.5,
    });
    expect(
      estimateOpenAiCost('gpt-5.4-mini-2026-03-17', {
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 600,
        reasoningTokens: 250,
        totalTokens: 1_600,
      }),
    ).toBeCloseTo(0.00045 + 0.00003 + 0.0027, 12);
  });


  it('prices fixed-snapshot speech input and audio output tokens', () => {
    expect(
      estimateOpenAiSpeechCost({
        inputTokens: 200,
        outputTokens: 1_250,
      }),
    ).toBeCloseTo(0.01512, 12);
  });
  it('does not fabricate an estimate for an unknown custom model', () => {
    expect(pricingForModel('gpt-custom-exact')).toBeNull();
    expect(
      estimateOpenAiCost('gpt-custom-exact', {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
        totalTokens: 2,
      }),
    ).toBeNull();
  });

  it('exposes a checked date and detects a stale packaged catalog', () => {
    expect(OPENAI_PRICING_CHECKED_DATE).toBe('2026-08-13');
    expect(pricingIsStale(new Date('2026-11-10T00:00:00Z'))).toBe(false);
    expect(pricingIsStale(new Date('2026-11-12T00:00:00Z'))).toBe(true);
  });
});
