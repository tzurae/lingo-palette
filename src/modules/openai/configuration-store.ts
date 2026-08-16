import { z } from 'zod';
import { codePointLength } from '../reading-flow/selection';

export const OPENAI_API_KEY_STORAGE_KEY = 'openAiApiKey';
export const OPENAI_CONFIGURATION_STORAGE_KEY = 'openAiConfiguration';
export const PERSONAL_INSTRUCTIONS_LIMIT = 4_000;

export const CURATED_OPENAI_MODELS = [
  'gpt-5.4-mini-2026-03-17',
  'gpt-5.4-nano-2026-03-17',
] as const;
export const CURATED_REASONING_EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;
export const CUSTOM_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

const reasoningEffortSchema = z.enum(CUSTOM_REASONING_EFFORTS);
const effortsSchema = z
  .object({
    quickHint: reasoningEffortSchema,
    deepDive: reasoningEffortSchema,
    review: reasoningEffortSchema,
  })
  .strict();
const configurationSchema = z
  .object({
    model: z.discriminatedUnion('kind', [
      z
        .object({ kind: z.literal('curated'), id: z.enum(CURATED_OPENAI_MODELS) })
        .strict(),
      z
        .object({ kind: z.literal('custom'), id: z.string().min(1) })
        .strict(),
    ]),
    efforts: effortsSchema,
    personalInstructions: z.string(),
  })
  .strict();

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type OpenAiConfiguration = z.infer<typeof configurationSchema>;

export const DEFAULT_OPENAI_CONFIGURATION: OpenAiConfiguration = {
  model: { kind: 'curated', id: 'gpt-5.4-mini-2026-03-17' },
  efforts: { quickHint: 'low', deepDive: 'medium', review: 'medium' },
  personalInstructions: '',
};

export type OpenAiStorageArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

type OpenAiSettings = {
  configuration: OpenAiConfiguration;
  hasApiKey: boolean;
};

type OpenAiRuntimeConfiguration = {
  configuration: OpenAiConfiguration;
  apiKey: string;
};

export function createOpenAiConfigurationStore(storage: OpenAiStorageArea): {
  loadSettings(): Promise<OpenAiSettings>;
  loadRuntimeConfiguration(): Promise<OpenAiRuntimeConfiguration | null>;
  activate(
    configuration: OpenAiConfiguration,
    apiKey?: string,
  ): Promise<void>;
  removeApiKey(): Promise<void>;
} {
  return {
    async loadSettings() {
      const stored = await readStoredState(storage);
      return {
        configuration: stored.configuration,
        hasApiKey: stored.apiKey !== null,
      };
    },

    async loadRuntimeConfiguration() {
      const stored = await readStoredState(storage);
      return stored.apiKey === null
        ? null
        : { configuration: stored.configuration, apiKey: stored.apiKey };
    },

    async activate(configuration, apiKey) {
      const parsedConfiguration = validateOpenAiConfiguration(configuration);
      if (apiKey !== undefined && apiKey.length === 0) {
        throw new Error('OpenAI API key 不可為空。');
      }
      const items: Record<string, unknown> = {
        [OPENAI_CONFIGURATION_STORAGE_KEY]: parsedConfiguration,
      };
      if (apiKey !== undefined) items[OPENAI_API_KEY_STORAGE_KEY] = apiKey;
      await storage.set(items);
    },

    async removeApiKey() {
      await storage.remove(OPENAI_API_KEY_STORAGE_KEY);
    },
  };
}

export function validateOpenAiConfiguration(
  value: unknown,
): OpenAiConfiguration {
  const parsed = configurationSchema.parse(value);
  const measuredLength = codePointLength(parsed.personalInstructions);
  if (measuredLength > PERSONAL_INSTRUCTIONS_LIMIT) {
    throw new Error(
      `Personal Instructions 有 ${measuredLength.toLocaleString('en-US')} 個字元，超過 ${PERSONAL_INSTRUCTIONS_LIMIT.toLocaleString('en-US')} 個字元上限；內容未被截斷。`,
    );
  }
  if (
    parsed.model.kind === 'curated' &&
    Object.values(parsed.efforts).some(
      (effort) =>
        !CURATED_REASONING_EFFORTS.includes(
          effort as (typeof CURATED_REASONING_EFFORTS)[number],
        ),
    )
  ) {
    const unsupported = Object.values(parsed.efforts).find(
      (effort) =>
        !CURATED_REASONING_EFFORTS.includes(
          effort as (typeof CURATED_REASONING_EFFORTS)[number],
        ),
    );
    throw new Error(`Curated OpenAI model 不支援 effort "${unsupported}"。`);
  }
  return parsed;
}

async function readStoredState(storage: OpenAiStorageArea): Promise<{
  configuration: OpenAiConfiguration;
  apiKey: string | null;
}> {
  const stored = await storage.get([
    OPENAI_CONFIGURATION_STORAGE_KEY,
    OPENAI_API_KEY_STORAGE_KEY,
  ]);
  const configuration =
    stored[OPENAI_CONFIGURATION_STORAGE_KEY] === undefined
      ? DEFAULT_OPENAI_CONFIGURATION
      : validateOpenAiConfiguration(stored[OPENAI_CONFIGURATION_STORAGE_KEY]);
  const apiKey = stored[OPENAI_API_KEY_STORAGE_KEY];
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length === 0)) {
    throw new Error('已儲存的 OpenAI API key 無效。');
  }
  return { configuration, apiKey: apiKey ?? null };
}
