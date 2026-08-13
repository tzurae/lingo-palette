import { describe, expect, it } from 'vitest';
import {
  createOpenAiConfigurationStore,
  DEFAULT_OPENAI_CONFIGURATION,
  type OpenAiConfiguration,
  type OpenAiStorageArea,
} from './configuration-store';

function memoryStorage(initial: Record<string, unknown> = {}): {
  area: OpenAiStorageArea;
  values: Record<string, unknown>;
  writes: Array<Record<string, unknown>>;
} {
  const values = { ...initial };
  const writes: Array<Record<string, unknown>> = [];
  return {
    values,
    writes,
    area: {
      async get(keys) {
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          requested
            .filter((key) => key in values)
            .map((key) => [key, values[key]]),
        );
      },
      async set(items) {
        writes.push(items);
        Object.assign(values, items);
      },
      async remove(key) {
        delete values[key];
      },
    },
  };
}

describe('OpenAI configuration store', () => {
  it('starts with the documented model and workload effort defaults', async () => {
    const storage = memoryStorage();
    const store = createOpenAiConfigurationStore(storage.area);

    await expect(store.loadSettings()).resolves.toEqual({
      configuration: DEFAULT_OPENAI_CONFIGURATION,
      hasApiKey: false,
    });
    expect(DEFAULT_OPENAI_CONFIGURATION).toEqual({
      model: {
        kind: 'curated',
        id: 'gpt-5.4-mini-2026-03-17',
      },
      efforts: {
        quickHint: 'low',
        deepDive: 'medium',
        review: 'medium',
      },
      personalInstructions: '',
    });
  });

  it('persists the exact active model separately from the device-local key', async () => {
    const storage = memoryStorage();
    const store = createOpenAiConfigurationStore(storage.area);
    const configuration: OpenAiConfiguration = {
      model: {
        kind: 'custom',
        id: 'ft:gpt-5.4-mini:team:Reading-Exact',
      },
      efforts: {
        quickHint: 'minimal',
        deepDive: 'high',
        review: 'max',
      },
      personalInstructions: 'Prefer concise Traditional Chinese cues.',
    };

    await store.activate(configuration, 'sk-device-only');

    expect(storage.writes).toEqual([
      {
        openAiConfiguration: configuration,
        openAiApiKey: 'sk-device-only',
      },
    ]);
    expect(JSON.stringify(storage.values.openAiConfiguration)).not.toContain(
      'sk-device-only',
    );
    await expect(
      createOpenAiConfigurationStore(storage.area).loadRuntimeConfiguration(),
    ).resolves.toEqual({ configuration, apiKey: 'sk-device-only' });
  });

  it('rejects rather than truncates over-limit Personal Instructions', async () => {
    const storage = memoryStorage({
      openAiConfiguration: DEFAULT_OPENAI_CONFIGURATION,
      openAiApiKey: 'sk-existing',
    });
    const store = createOpenAiConfigurationStore(storage.area);
    const overLimit = '😀'.repeat(4_001);

    await expect(
      store.activate({
        ...DEFAULT_OPENAI_CONFIGURATION,
        personalInstructions: overLimit,
      }),
    ).rejects.toThrow('4,001');

    expect(storage.writes).toHaveLength(0);
    await expect(store.loadRuntimeConfiguration()).resolves.toEqual({
      configuration: DEFAULT_OPENAI_CONFIGURATION,
      apiKey: 'sk-existing',
    });
  });

  it('limits curated models to their documented efforts without restricting custom probes', async () => {
    const storage = memoryStorage();
    const store = createOpenAiConfigurationStore(storage.area);

    await expect(
      store.activate({
        ...DEFAULT_OPENAI_CONFIGURATION,
        efforts: {
          ...DEFAULT_OPENAI_CONFIGURATION.efforts,
          quickHint: 'minimal',
        },
      }),
    ).rejects.toThrow('minimal');

    await expect(
      store.activate({
        model: { kind: 'custom', id: 'gpt-custom-exact' },
        efforts: { quickHint: 'minimal', deepDive: 'xhigh', review: 'max' },
        personalInstructions: '',
      }),
    ).resolves.toBeUndefined();
  });

  it('removes the key without deleting portable configuration', async () => {
    const storage = memoryStorage({
      openAiConfiguration: DEFAULT_OPENAI_CONFIGURATION,
      openAiApiKey: 'sk-existing',
    });
    const store = createOpenAiConfigurationStore(storage.area);

    await store.removeApiKey();

    await expect(store.loadSettings()).resolves.toEqual({
      configuration: DEFAULT_OPENAI_CONFIGURATION,
      hasApiKey: false,
    });
    expect(storage.values.openAiConfiguration).toEqual(
      DEFAULT_OPENAI_CONFIGURATION,
    );
  });
});
