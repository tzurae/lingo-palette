import type { BudgetSnapshot, DailyBudget } from './budget-ledger';
import { z } from 'zod';
import {
  CUSTOM_REASONING_EFFORTS,
  validateOpenAiConfiguration,
  type OpenAiConfiguration,
  type ReasoningEffort,
} from './configuration-store';
import {
  OPENAI_COMPATIBILITY_KINDS,
  type CapabilityProbeReport,
  type OpenAiCompatibilityKind,
} from './openai-responses';

export type OpenAiSettingsRequest =
  | { type: 'get-openai-settings' }
  | {
      type: 'activate-openai-configuration';
      configuration: OpenAiConfiguration;
      apiKey?: string;
    }
  | { type: 'remove-openai-api-key' }
  | { type: 'update-openai-budget'; budget: DailyBudget };

export type OpenAiSettingsSnapshot = {
  configuration: OpenAiConfiguration;
  hasApiKey: boolean;
  budget: BudgetSnapshot;
  pricing: {
    checkedDate: string;
    stale: boolean;
    usageDashboardUrl: string;
    estimatedCostBudgetAvailable: boolean;
  };
};

export type OpenAiSettingsResponse =
  | {
      status: 'loaded';
      settings: OpenAiSettingsSnapshot;
    }
  | {
      status: 'activated';
      settings: OpenAiSettingsSnapshot;
      probes: CapabilityProbeReport[];
    }
  | { status: 'key-removed'; settings: OpenAiSettingsSnapshot }
  | { status: 'budget-updated'; settings: OpenAiSettingsSnapshot }
  | {
      status: 'failed';
      message: string;
      probes?: CapabilityProbeReport[] | undefined;
      incompatibility?:
        | {
            kind: OpenAiCompatibilityKind;
            model: string;
            effort: ReasoningEffort;
          }
        | undefined;
    };

const configurationResponseSchema = z.unknown().transform((value, context) => {
  try {
    return validateOpenAiConfiguration(value);
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'Invalid OpenAI configuration response.',
    });
    return z.NEVER;
  }
});
const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
});
const budgetSettingsSchema = z.object({
  tokenLimit: z.number().int().nonnegative(),
  estimatedCostUsdLimit: z.number().nonnegative(),
});
const budgetSnapshotSchema = z.object({
  settings: budgetSettingsSchema,
  activeDate: z.string(),
  nextLocalReset: z.string(),
  used: usageSchema,
  reserved: z.object({
    tokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  }),
});
const settingsSnapshotSchema = z.object({
  configuration: configurationResponseSchema,
  hasApiKey: z.boolean(),
  budget: budgetSnapshotSchema,
  pricing: z.object({
    checkedDate: z.string(),
    stale: z.boolean(),
    usageDashboardUrl: z.string().url(),
    estimatedCostBudgetAvailable: z.boolean(),
  }),
});
const probeReportSchema = z.object({
  model: z.string(),
  effort: z.enum(CUSTOM_REASONING_EFFORTS),
  usage: usageSchema.omit({ estimatedCostUsd: true }),
});
const settingsResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('loaded'), settings: settingsSnapshotSchema }),
  z.object({
    status: z.literal('activated'),
    settings: settingsSnapshotSchema,
    probes: z.array(probeReportSchema),
  }),
  z.object({
    status: z.literal('key-removed'),
    settings: settingsSnapshotSchema,
  }),
  z.object({
    status: z.literal('budget-updated'),
    settings: settingsSnapshotSchema,
  }),
  z.object({
    status: z.literal('failed'),
    message: z.string(),
    probes: z.array(probeReportSchema).optional(),
    incompatibility: z
      .object({
        kind: z.enum(OPENAI_COMPATIBILITY_KINDS),
        model: z.string(),
        effort: z.enum(CUSTOM_REASONING_EFFORTS),
      })
      .optional(),
  }),
]);

export function parseOpenAiSettingsResponse(
  value: unknown,
): OpenAiSettingsResponse {
  return settingsResponseSchema.parse(value);
}
