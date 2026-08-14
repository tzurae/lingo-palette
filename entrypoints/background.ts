import {
  createBudgetLedger,
  type ProviderUsage,
} from '../src/modules/openai/budget-ledger';
import {
  createLookupRecordStore,
  sanitizeSourceUrl,
} from '../src/modules/learning/lookup-record';
import { z } from 'zod';
import {
  createOpenAiConfigurationStore,
  validateOpenAiConfiguration,
  type OpenAiConfiguration,
} from '../src/modules/openai/configuration-store';
import { AssistanceFailure, createQuickHintExecutor } from '../src/modules/openai/quick-hint-executor';
import { createDeepDiveExecutor } from '../src/modules/openai/deep-dive-executor';
import {
  OPENAI_PRICING_CHECKED_DATE,
  OPENAI_USAGE_DASHBOARD_URL,
  estimateOpenAiCost,
  pricingForModel,
  pricingIsStale,
} from '../src/modules/openai/pricing';
import type {
  OpenAiSettingsRequest,
  OpenAiSettingsResponse,
  OpenAiSettingsSnapshot,
} from '../src/modules/openai/messages';
import {
  createOpenAiResponsesClient,
  OpenAiCompatibilityError,
  OpenAiProviderError,
  type CapabilityProbeReport,
  type OpenAiUsage,
} from '../src/modules/openai/openai-responses';
import { parseDeepDive } from '../src/modules/reading-flow/deep-dive';
import { createDeepDiveStateStore } from '../src/modules/reading-flow/deep-dive-state';
import { parseQuickHint } from '../src/modules/reading-flow/quick-hint';
import {
  isSupportedOrigin,
  scriptIdFor,
} from '../src/modules/reading-flow/site-permission';
import type { Selection } from '../src/modules/reading-flow/selection';
import { parseSelection } from '../src/modules/reading-flow/selection-parser';
import type {
  DeepDiveResponse,
  EnableSiteResponse,
  QuickHintResponse,
  ReadingFlowRequest,
  RecentResponse,
} from '../src/modules/reading-flow/messages';

const readingFlowScript = '/reading-flow.js';
const focusEvent = 'lingo-palette:focus-selection-toolbar';
const openAiConfigurationStore = createOpenAiConfigurationStore(
  browser.storage.local,
);
const budgetLedger = createBudgetLedger(browser.storage.local);
const lookupRecordStore = createLookupRecordStore(browser.storage.local);
const quickHintCacheStorageKey = 'quickHintCacheV1';
const maximumQuickHintCacheEntries = 100;
const deepDiveCacheStorageKey = 'deepDiveCacheV1';
const maximumDeepDiveCacheEntries = 100;
let activeOpenAiProbe: AbortController | null = null;
let openAiActivationVersion = 0;
type QuickHintActivity = {
  controller: AbortController;
  completionClaimed: boolean;
};
const activeQuickHints = new Map<string, QuickHintActivity>();
let activeDeepDive: {
  requestId: string;
  controller: AbortController;
  completionClaimed: boolean;
} | null = null;
const quickHintCacheSchema = z.record(z.string(), z.unknown());
let deepDiveStartVersion = 0;
const deepDiveCacheSchema = z.record(z.string(), z.unknown());
const controlledResponseQueueSchema = z.array(
  z.object({
    status: z.number().int(),
    body: z.unknown(),
    delayMs: z.number().int().nonnegative().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
);
const controlledRequestSchema = z.object({
  text: z.object({ format: z.object({ name: z.string() }) }),
});
const openAiResponsesClient = createOpenAiResponsesClient(
  import.meta.env.WXT_TEST_BROWSER === 'true' ? controlledOpenAiFetch : fetch,
);
const quickHintExecutor = createQuickHintExecutor({
  isOnline: async () =>
    import.meta.env.WXT_TEST_BROWSER === 'true'
      ? (await browser.storage.local.get('openAiTestOnline'))
          .openAiTestOnline !== false
      : navigator.onLine,
  cache: {
    async get(key) {
      const stored = await browser.storage.local.get(quickHintCacheStorageKey);
      const parsed = quickHintCacheSchema.safeParse(
        stored[quickHintCacheStorageKey],
      );
      if (!parsed.success) return null;
      const raw = parsed.data[key];
      try {
        return parseQuickHint(raw);
      } catch {
        return null;
      }
    },
    async put(key, value) {
      await serializeQuickHintCacheWrite(async () => {
        const stored = await browser.storage.local.get(quickHintCacheStorageKey);
        const parsed = quickHintCacheSchema.safeParse(
          stored[quickHintCacheStorageKey],
        );
        const cache = parsed.success ? { ...parsed.data } : {};
        delete cache[key];
        cache[key] = value;
        const keys = Object.keys(cache);
        for (
          let index = 0;
          index < keys.length - maximumQuickHintCacheEntries;
          index += 1
        ) {
          const oldest = keys[index];
          if (oldest !== undefined) delete cache[oldest];
        }
        await browser.storage.local.set({
          [quickHintCacheStorageKey]: cache,
        });
      });
    },
  },
  budget: budgetLedger,
  provider: {
    async generate(input, signal) {
      try {
        const generated = await openAiResponsesClient.generateQuickHint(
          input,
          signal,
        );
        return {
          result: generated.result,
          usage: providerUsage(input.configuration.model.id, generated.usage),
        };
      } catch (error) {
        throw asAssistanceFailure(error, input.configuration.model.id);
      }
    },
  },
  wait: waitForRetry,
  random: Math.random,
});
const deepDiveStateStore = createDeepDiveStateStore(browser.storage.local);
const deepDiveExecutor = createDeepDiveExecutor({
  isOnline: async () =>
    import.meta.env.WXT_TEST_BROWSER === 'true'
      ? (await browser.storage.local.get('openAiTestOnline'))
          .openAiTestOnline !== false
      : navigator.onLine,
  cache: {
    async get(key) {
      const stored = await browser.storage.local.get(deepDiveCacheStorageKey);
      const parsed = deepDiveCacheSchema.safeParse(
        stored[deepDiveCacheStorageKey],
      );
      if (!parsed.success) return null;
      try {
        return parseDeepDive(parsed.data[key]);
      } catch {
        return null;
      }
    },
    async put(key, value) {
      await serializeDeepDiveCacheWrite(async () => {
        const stored = await browser.storage.local.get(deepDiveCacheStorageKey);
        const parsed = deepDiveCacheSchema.safeParse(
          stored[deepDiveCacheStorageKey],
        );
        const cache = parsed.success ? { ...parsed.data } : {};
        delete cache[key];
        cache[key] = value;
        const keys = Object.keys(cache);
        for (
          let index = 0;
          index < keys.length - maximumDeepDiveCacheEntries;
          index += 1
        ) {
          const oldest = keys[index];
          if (oldest !== undefined) delete cache[oldest];
        }
        await browser.storage.local.set({
          [deepDiveCacheStorageKey]: cache,
        });
      });
    },
  },
  budget: budgetLedger,
  provider: {
    async generate(input, signal) {
      try {
        const generated = await openAiResponsesClient.generateDeepDive(
          input,
          signal,
        );
        return {
          result: generated.result,
          usage: providerUsage(input.configuration.model.id, generated.usage),
        };
      } catch (error) {
        throw asAssistanceFailure(error, input.configuration.model.id);
      }
    },
  },
  wait: waitForRetry,
  random: Math.random,
});

function createSerialExecutor(): <T>(
  operation: () => Promise<T>,
) => Promise<T> {
  let pending = Promise.resolve();
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = pending;
    const completion = Promise.withResolvers<void>();
    pending = completion.promise;
    await previous;
    try {
      return await operation();
    } finally {
      completion.resolve();
    }
  };
}

const serializeQuickHintCacheWrite = createSerialExecutor();
const serializeDeepDiveCacheWrite = createSerialExecutor();
const serializeDeepDiveLifecycle = createSerialExecutor();
const serializeOpenAiConfigurationMutation = createSerialExecutor();

let backgroundInitialization = Promise.resolve();

export default defineBackground(() => {
  backgroundInitialization = initializeBackgroundState();
  registerBackgroundListeners();
});

async function initializeBackgroundState(): Promise<void> {
  await browser.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await deepDiveStateStore.interruptRunning();
}

function registerBackgroundListeners(): void {
  browser.action.onClicked.addListener((tab) => {
    void injectReadingFlow(tab.id, false);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'focus-selection-toolbar') return;
    if (tab?.id !== undefined) {
      void injectReadingFlow(tab.id, true);
      return;
    }
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([activeTab]) => injectReadingFlow(activeTab?.id, true));
  });

  browser.runtime.onMessage.addListener(
    (
      message: ReadingFlowRequest | OpenAiSettingsRequest,
      sender,
    ):
      | Promise<
          | DeepDiveResponse
          | EnableSiteResponse
          | QuickHintResponse
          | OpenAiSettingsResponse
          | RecentResponse
        >
      | undefined => {
      if (message.type === 'site-status') {
        return siteStatus(message.origin, sender);
      }
      if (message.type === 'enable-site') {
        return enableSite(message.origin, sender);
      }
      if (message.type === 'quick-hint') {
        return generateQuickHint(message.selection, sender);
      }
      if (message.type === 'cancel-quick-hint') {
        return cancelQuickHint(sender);
      }
      if (message.type === 'start-deep-dive') {
        return startDeepDive(message.selection, sender);
      }
      if (message.type === 'get-deep-dive-state') {
        return getDeepDiveState(sender);
      }
      if (message.type === 'retry-deep-dive') {
        return retryDeepDive(sender);
      }
      if (message.type === 'cancel-deep-dive') {
        return cancelDeepDive(sender);
      }
      if (message.type === 'get-recent') {
        return getRecent(sender);
      }
      return handleOpenAiSettings(message, sender);
    },
  );
}

async function injectReadingFlow(
  tabId: number | undefined,
  focus: boolean,
): Promise<void> {
  if (tabId === undefined) return;
  await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [readingFlowScript],
  });
  if (!focus) return;
  await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (eventName) => window.dispatchEvent(new Event(eventName)),
    args: [focusEvent],
  });
}
async function siteStatus(
  origin: string,
  sender: Browser.runtime.MessageSender,
): Promise<EnableSiteResponse> {
  if (!isAuthorizedSiteSender(sender, origin)) {
    return { enabled: false };
  }
  return {
    enabled: await browser.permissions.contains({ origins: [`${origin}/*`] }),
  };
}


async function enableSite(
  origin: string,
  sender: Browser.runtime.MessageSender,
): Promise<EnableSiteResponse> {
  if (!isAuthorizedSiteSender(sender, origin)) {
    return { enabled: false, message: '只能啟用目前的 HTTP(S) 網站。' };
  }

  const match = `${origin}/*`;
  const enabled = await browser.permissions.request({ origins: [match] });
  if (!enabled) return { enabled: false, message: '未授予網站存取權。' };

  const id = scriptIdFor(origin);
  const registered = await browser.scripting.getRegisteredContentScripts({
    ids: [id],
  });
  if (registered.length === 0) {
    await browser.scripting.registerContentScripts([
      {
        id,
        js: [readingFlowScript],
        matches: [match],
        allFrames: true,
        matchOriginAsFallback: true,
        persistAcrossSessions: true,
        runAt: 'document_idle',
      },
    ]);
  }

  return { enabled: true };
}

async function generateQuickHint(
  selection: Selection,
  sender: Browser.runtime.MessageSender,
): Promise<QuickHintResponse> {
  const requestKey = quickHintRequestKey(sender);
  const prior = activeQuickHints.get(requestKey);
  if (prior?.completionClaimed === false) prior.controller.abort();
  const activity: QuickHintActivity = {
    controller: new AbortController(),
    completionClaimed: false,
  };
  activeQuickHints.set(requestKey, activity);
  try {
    return await generateQuickHintRequest(selection, sender, activity);
  } finally {
    if (activeQuickHints.get(requestKey) === activity) {
      activeQuickHints.delete(requestKey);
    }
  }
}

async function generateQuickHintRequest(
  selection: Selection,
  sender: Browser.runtime.MessageSender,
  activity: QuickHintActivity,
): Promise<QuickHintResponse> {
  const origin = originForSender(sender);
  if (
    origin === null ||
    !(await browser.permissions.contains({ origins: [`${origin}/*`] }))
  ) {
    return {
      status: 'failed',
      message: '請先啟用目前網站，再使用快速提示。',
    };
  }

  let providerSelection: Selection;
  try {
    providerSelection = parseSelection(selection);
  } catch {
    return {
      status: 'failed',
      message: '選取內容超過快速提示可接受的範圍。',
    };
  }

  const settings = await openAiConfigurationStore.loadSettings();
  const runtime = await openAiConfigurationStore.loadRuntimeConfiguration();
  try {
    if (import.meta.env.WXT_TEST_BROWSER === 'true') {
      await browser.storage.local.set({
        quickHintTestRequest: providerSelection,
      });
    }
    const outcome = await quickHintExecutor.execute(
      {
        apiKey: runtime?.apiKey ?? '',
        configuration: settings.configuration,
        selection: providerSelection,
      },
      activity.controller.signal,
      (progress) => {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return;
        void browser.tabs
          .sendMessage(
            tabId,
            {
              type: 'quick-hint-progress',
              message: `OpenAI ${progress.kind}；第 ${progress.completedAttempts} 次嘗試未完成，${Math.ceil(progress.delayMs / 100) / 10} 秒後進行第 ${progress.nextAttempt} 次。`,
            },
            { frameId: sender.frameId ?? 0 },
          )
          .catch(() => undefined);
      },
    );
    if (activity.controller.signal.aborted) {
      return {
        status: 'cancelled',
        message: '已取消 Quick Hint；Selection 仍保留。',
      };
    }
    activity.completionClaimed = true;
    await lookupRecordStore.append({
      selection: providerSelection,
      action: { type: 'quick-hint', result: outcome.result },
      usage: {
        source: outcome.source,
        attempts: outcome.attempts,
        provider: outcome.usage,
      },
      ...(sender.url === undefined ? {} : { sourceUrl: sender.url }),
    });
    return { status: 'completed', ...outcome };
  } catch (error) {
    if (error instanceof AssistanceFailure) {
      if (error.kind === 'cancelled') {
        return { status: 'cancelled', message: error.message };
      }
      return {
        status: 'failed',
        message: error.message,
        kind: error.kind,
        retryable: error.retryable,
      };
    }
    return {
      status: 'failed',
      message:
        error instanceof Error
          ? error.message
          : 'OpenAI assistance 無法產生 Quick Hint。',
    };
  }
}

async function cancelQuickHint(
  sender: Browser.runtime.MessageSender,
): Promise<QuickHintResponse> {
  const activity = activeQuickHints.get(quickHintRequestKey(sender));
  if (activity?.completionClaimed === true) {
    return {
      status: 'failed',
      message: 'Quick Hint 已完成並保存到 Recent；取消未生效。',
    };
  }
  activity?.controller.abort();
  return { status: 'cancelled', message: '已取消 Quick Hint；Selection 仍保留。' };
}

async function startDeepDive(
  selection: Selection,
  sender: Browser.runtime.MessageSender,
): Promise<DeepDiveResponse> {
  const origin = originForSender(sender);
  const tabId = sender.tab?.id;
  if (origin === null || tabId === undefined) {
    return { status: 'failed', message: '只能分析目前網站的 Selection。' };
  }

  let providerSelection: Selection;
  try {
    providerSelection = parseSelection(selection);
  } catch {
    return {
      status: 'failed',
      message: '選取內容超過 Deep Dive 可接受的範圍。',
    };
  }

  const panelOpening = browser.sidePanel.open({ tabId });
  try {
    await backgroundInitialization;
  } catch {
    void panelOpening.catch(() => undefined);
    return {
      status: 'failed',
      message: 'Lingo Palette background 無法初始化；請重新載入 extension。',
    };
  }
  if (
    !(await browser.permissions.contains({ origins: [`${origin}/*`] }))
  ) {
    void panelOpening.catch(() => undefined);
    return {
      status: 'failed',
      message: '請先啟用目前網站，再使用 Deep Dive。',
    };
  }
  try {
    await panelOpening;
  } catch {
    return {
      status: 'failed',
      message: 'Chrome 無法開啟 Lingo Palette Side Panel；請再試一次。',
    };
  }

  return beginDeepDive(providerSelection, sender.url);
}

async function beginDeepDive(
  selection: Selection,
  sourceUrl?: string,
): Promise<DeepDiveResponse> {
  const startVersion = deepDiveStartVersion + 1;
  deepDiveStartVersion = startVersion;
  if (activeDeepDive?.completionClaimed === false) {
    activeDeepDive.controller.abort();
  }
  return serializeDeepDiveLifecycle(async () => {
    const request = await deepDiveStateStore.begin(
      selection,
      sanitizeSourceUrl(sourceUrl),
    );
    if (startVersion !== deepDiveStartVersion) {
      const message =
        '此 Deep Dive 已由較新的明確要求取代；Selection 仍保留。';
      await deepDiveStateStore.cancel(request.id, message);
      return { status: 'cancelled', message };
    }
    const controller = new AbortController();
    activeDeepDive = {
      requestId: request.id,
      controller,
      completionClaimed: false,
    };
    void executeDeepDive(
      request.id,
      selection,
      controller,
      request.sourceUrl,
    );
    return { status: 'started', requestId: request.id };
  });
}

async function executeDeepDive(
  requestId: string,
  selection: Selection,
  controller: AbortController,
  sourceUrl?: string,
): Promise<void> {
  try {
    const settings = await openAiConfigurationStore.loadSettings();
    const runtime = await openAiConfigurationStore.loadRuntimeConfiguration();
    if (import.meta.env.WXT_TEST_BROWSER === 'true') {
      await browser.storage.local.set({ deepDiveTestRequest: selection });
    }
    const outcome = await deepDiveExecutor.execute(
      {
        apiKey: runtime?.apiKey ?? '',
        configuration: settings.configuration,
        selection,
      },
      controller.signal,
    );
    await serializeDeepDiveLifecycle(async () => {
      if (controller.signal.aborted) {
        await deepDiveStateStore.cancel(
          requestId,
          '已取消 Deep Dive；Selection 仍保留，可明確重試。',
        );
        return;
      }
      const state = await deepDiveStateStore.load();
      if (
        state.request?.id !== requestId ||
        state.request.status !== 'working'
      ) {
        return;
      }
      const activity = activeDeepDive;
      if (
        activity?.requestId !== requestId ||
        activity.controller !== controller
      ) {
        return;
      }
      activity.completionClaimed = true;
      await deepDiveStateStore.settle(
        requestId,
        {
          status: 'completed',
          result: outcome.result,
        },
        async (deepDiveItems) => {
          await lookupRecordStore.append(
            {
              selection,
              action: { type: 'deep-dive', result: outcome.result },
              usage: {
                source: outcome.source,
                attempts: outcome.attempts,
                provider: outcome.usage,
              },
              ...(sourceUrl === undefined ? {} : { sourceUrl }),
            },
            async (lookupItems) => {
              await browser.storage.local.set({
                ...deepDiveItems,
                ...lookupItems,
              });
            },
          );
        },
      );
    });
  } catch (error) {
    const failure =
      error instanceof AssistanceFailure
        ? error
        : new AssistanceFailure({
            kind: 'provider-unavailable',
            message:
              error instanceof Error
                ? error.message
                : 'OpenAI assistance 無法產生 Deep Dive。',
            retryable: false,
          });
    await serializeDeepDiveLifecycle(() =>
      deepDiveStateStore.settle(requestId, {
        status: failure.kind === 'cancelled' ? 'cancelled' : 'failed',
        message: failure.message,
      }),
    );
  } finally {
    if (activeDeepDive?.controller === controller) activeDeepDive = null;
  }
}

async function getDeepDiveState(
  sender: Browser.runtime.MessageSender,
): Promise<DeepDiveResponse> {
  if (!isTrustedExtensionSender(sender)) {
    return { status: 'failed', message: '只有 Lingo Palette Side Panel 可以讀取 Current。' };
  }
  await backgroundInitialization;
  return { status: 'loaded', state: await deepDiveStateStore.load() };
}

async function getRecent(
  sender: Browser.runtime.MessageSender,
): Promise<RecentResponse> {
  if (!isTrustedExtensionSender(sender)) {
    return {
      status: 'failed',
      message: '只有 Lingo Palette Side Panel 可以讀取 Recent。',
    };
  }
  await backgroundInitialization;
  return { status: 'loaded', records: await lookupRecordStore.list() };
}

async function retryDeepDive(
  sender: Browser.runtime.MessageSender,
): Promise<DeepDiveResponse> {
  if (!isTrustedExtensionSender(sender)) {
    return { status: 'failed', message: '只有 Lingo Palette Side Panel 可以重試 Deep Dive。' };
  }
  await backgroundInitialization;
  const state = await deepDiveStateStore.load();
  if (state.request === null || state.request.status === 'working') {
    return { status: 'failed', message: '目前沒有可重試的 Deep Dive。' };
  }
  return beginDeepDive(state.request.selection, state.request.sourceUrl);
}

async function cancelDeepDive(
  sender: Browser.runtime.MessageSender,
): Promise<DeepDiveResponse> {
  if (!isTrustedExtensionSender(sender)) {
    return { status: 'failed', message: '只有 Lingo Palette Side Panel 可以取消 Deep Dive。' };
  }
  await backgroundInitialization;
  deepDiveStartVersion += 1;
  const active = activeDeepDive;
  if (active?.completionClaimed === false) active.controller.abort();
  const message = '已取消 Deep Dive；Selection 仍保留，可明確重試。';
  return serializeDeepDiveLifecycle(async () => {
    if (active !== null) {
      return {
        status: 'loaded',
        state: await deepDiveStateStore.cancel(active.requestId, message),
      };
    }
    const state = await deepDiveStateStore.load();
    if (state.request?.status !== 'working') {
      return { status: 'loaded', state };
    }
    return {
      status: 'loaded',
      state: await deepDiveStateStore.cancel(state.request.id, message),
    };
  });
}

async function handleOpenAiSettings(
  message: OpenAiSettingsRequest,
  sender: Browser.runtime.MessageSender,
): Promise<OpenAiSettingsResponse> {
  if (!isTrustedExtensionSender(sender)) {
    return { status: 'failed', message: '只有 Lingo Palette Settings 可以變更 OpenAI 設定。' };
  }

  try {
    if (message.type === 'get-openai-settings') {
      return {
        status: 'loaded',
        settings: await loadOpenAiSettings(),
      };
    }
    if (message.type === 'remove-openai-api-key') {
      openAiActivationVersion += 1;
      activeOpenAiProbe?.abort();
      await serializeOpenAiConfigurationMutation(() =>
        openAiConfigurationStore.removeApiKey(),
      );
      return {
        status: 'key-removed',
        settings: await loadOpenAiSettings(),
      };
    }
    if (message.type === 'update-openai-budget') {
      await budgetLedger.configure(message.budget);
      return {
        status: 'budget-updated',
        settings: await loadOpenAiSettings(),
      };
    }

    const configuration = validateOpenAiConfiguration(message.configuration);
    const activationVersion = openAiActivationVersion + 1;
    openAiActivationVersion = activationVersion;
    activeOpenAiProbe?.abort();
    const current = await openAiConfigurationStore.loadRuntimeConfiguration();
    if (activationVersion !== openAiActivationVersion) {
      throw new Error('此 OpenAI 設定請求已被較新的設定取代。');
    }
    const apiKey = message.apiKey ?? current?.apiKey;
    if (apiKey === undefined || apiKey.length === 0) {
      return {
        status: 'failed',
        message: '請輸入 OpenAI API key；既有 key 不會顯示或匯出。',
      };
    }

    let probes: CapabilityProbeReport[] = [];
    if (configuration.model.kind === 'custom') {
      const controller = new AbortController();
      activeOpenAiProbe = controller;
      try {
        probes = await runBudgetedProbes(
          apiKey,
          configuration,
          controller.signal,
        );
      } finally {
        if (activeOpenAiProbe === controller) activeOpenAiProbe = null;
      }
    }
    const activated = await serializeOpenAiConfigurationMutation(async () => {
      if (activationVersion !== openAiActivationVersion) return false;
      await openAiConfigurationStore.activate(configuration, message.apiKey);
      return true;
    });
    if (!activated) {
      throw new Error('此 OpenAI 設定請求已被較新的設定取代。');
    }
    return {
      status: 'activated',
      settings: await loadOpenAiSettings(),
      probes,
    };
  } catch (error) {
    if (error instanceof OpenAiCompatibilityError) {
      return {
        status: 'failed',
        message: error.message,
        probes: error.completedProbes,
        incompatibility: {
          kind: error.kind,
          model: error.model,
          effort: error.effort,
        },
      };
    }
    if (error instanceof OpenAiProviderError) {
      return {
        status: 'failed',
        message: error.message,
        probes: error.completedProbes,
      };
    }
    return {
      status: 'failed',
      message:
        error instanceof Error ? error.message : '無法更新 OpenAI 設定。',
    };
  }
}

async function loadOpenAiSettings(): Promise<OpenAiSettingsSnapshot> {
  const settings = await openAiConfigurationStore.loadSettings();
  return {
    ...settings,
    budget: await budgetLedger.snapshot(),
    pricing: {
      checkedDate: OPENAI_PRICING_CHECKED_DATE,
      stale: pricingIsStale(new Date()),
      usageDashboardUrl: OPENAI_USAGE_DASHBOARD_URL,
      estimatedCostBudgetAvailable:
        pricingForModel(settings.configuration.model.id) !== null,
    },
  };
}

async function runBudgetedProbes(
  apiKey: string,
  configuration: OpenAiConfiguration,
  signal: AbortSignal,
) {
  const effortCount = new Set(Object.values(configuration.efforts)).size;
  const tokens = effortCount * 8_192;
  const estimatedCostUsd = estimateOpenAiCost(configuration.model.id, {
    inputTokens: effortCount * (8_192 - 256),
    cachedInputTokens: 0,
    outputTokens: effortCount * 256,
    reasoningTokens: effortCount * 256,
    totalTokens: tokens,
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const reserved = await budgetLedger.reserve({ tokens, estimatedCostUsd });
    if (reserved.status === 'blocked') {
      throw new AssistanceFailure({
        kind: 'local-budget',
        message:
          reserved.kind === 'provider-disabled'
            ? 'OpenAI provider Actions 已由每日上限 0 明確停用。'
            : '每日 hard limit 無法預留 Custom model capability probes。',
        retryable: false,
        budgetKind: reserved.kind,
      });
    }

    try {
      const reports = await openAiResponsesClient.probeAndReport(
        { apiKey, configuration },
        signal,
      );
      await settleProbeReservation(
        reserved.reservation,
        configuration.model.id,
        reports.map((report) => report.usage),
      );
      return reports;
    } catch (error) {
      const completed =
        error instanceof OpenAiCompatibilityError ||
        error instanceof OpenAiProviderError
          ? error.completedProbes.map((report) => report.usage)
          : [];
      if (
        (error instanceof OpenAiProviderError ||
          error instanceof OpenAiCompatibilityError) &&
        error.usage !== undefined
      ) {
        completed.push(error.usage);
      }
      await settleProbeReservation(
        reserved.reservation,
        configuration.model.id,
        completed,
      );
      if (
        !(error instanceof OpenAiProviderError) ||
        !error.retryable ||
        attempt === 3
      ) {
        throw error;
      }
      const delay =
        error.retryAfterMs ??
        Math.min(5_000, 500 * 2 ** (attempt - 1) * (1 + Math.random() * 0.5));
      await waitForRetry(delay, signal);
    }
  }
  throw new Error('Capability probe retry loop ended unexpectedly.');
}

async function settleProbeReservation(
  reservation: Parameters<typeof budgetLedger.reconcile>[0],
  model: string,
  usages: OpenAiUsage[],
): Promise<void> {
  if (usages.length === 0) {
    await budgetLedger.release(reservation);
    return;
  }
  const usage = usages.reduce<ProviderUsage>(
    (total, current) => {
      const item = providerUsage(model, current);
      return {
        inputTokens: total.inputTokens + item.inputTokens,
        cachedInputTokens:
          total.cachedInputTokens + item.cachedInputTokens,
        outputTokens: total.outputTokens + item.outputTokens,
        reasoningTokens: total.reasoningTokens + item.reasoningTokens,
        totalTokens: total.totalTokens + item.totalTokens,
        estimatedCostUsd:
          total.estimatedCostUsd === null || item.estimatedCostUsd === null
            ? null
            : total.estimatedCostUsd + item.estimatedCostUsd,
      };
    },
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    },
  );
  await budgetLedger.reconcile(reservation, usage);
}

function providerUsage(model: string, usage: OpenAiUsage): ProviderUsage {
  return {
    ...usage,
    estimatedCostUsd: estimateOpenAiCost(model, usage),
  };
}

function asAssistanceFailure(
  error: unknown,
  model: string,
): AssistanceFailure {
  if (error instanceof AssistanceFailure) return error;
  if (error instanceof OpenAiProviderError) {
    return new AssistanceFailure({
      kind: error.providerKind,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: error.retryAfterMs }),
      ...(error.usage === undefined
        ? {}
        : { usage: providerUsage(model, error.usage) }),
    });
  }
  if (error instanceof OpenAiCompatibilityError) {
    return new AssistanceFailure({
      kind: 'incompatible',
      message: error.message,
      retryable: false,
      ...(error.usage === undefined
        ? {}
        : { usage: providerUsage(model, error.usage) }),
    });
  }
  return new AssistanceFailure({
    kind: 'provider-unavailable',
    message: error instanceof Error ? error.message : 'OpenAI request failed.',
    retryable: false,
  });
}

function quickHintRequestKey(sender: Browser.runtime.MessageSender): string {
  return `${sender.tab?.id ?? 'unknown'}:${sender.frameId ?? 0}`;
}

async function waitForRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const deferred = Promise.withResolvers<void>();
  const timer = setTimeout(deferred.resolve, delayMs);
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      deferred.reject(new DOMException('Aborted', 'AbortError'));
    },
    { once: true },
  );
  return deferred.promise;
}

function isTrustedExtensionSender(
  sender: Browser.runtime.MessageSender,
): boolean {
  return sender.url?.startsWith(browser.runtime.getURL('/')) === true;
}

async function controlledOpenAiFetch(
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const rawRequest: unknown = JSON.parse(String(init?.body));
  const request = controlledRequestSchema.parse(rawRequest);
  const stored = await browser.storage.local.get([
    'openAiTestResponses',
    'quickHintTestFixture',
    'deepDiveTestFixture',
    'openAiTestRequests',
  ]);
  const priorRequests = Array.isArray(stored.openAiTestRequests)
    ? stored.openAiTestRequests
    : [];
  const parsedQueue = controlledResponseQueueSchema.safeParse(
    stored.openAiTestResponses,
  );
  const queue = parsedQueue.success ? parsedQueue.data : [];
  const next = queue[0];
  await browser.storage.local.set({
    openAiTestRequests: [...priorRequests, rawRequest],
    openAiTestResponses: queue.slice(1),
  });
  if (next !== undefined) {
    if (next.delayMs !== undefined) {
      await waitForRetry(
        next.delayMs,
        init?.signal ?? new AbortController().signal,
      );
    }
    return Response.json(next.body, {
      status: next.status,
      ...(next.headers === undefined ? {} : { headers: next.headers }),
    });
  }

  const output =
    request.text.format.name === 'quick_hint'
      ? stored.quickHintTestFixture
      : request.text.format.name === 'deep_dive'
        ? stored.deepDiveTestFixture
        : { compatible: true };
  return Response.json({
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(output) }],
      },
    ],
    usage: {
      input_tokens: 11,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 18,
    },
  });
}

function isAuthorizedSiteSender(
  sender: Browser.runtime.MessageSender,
  origin: string,
): boolean {
  return isSupportedOrigin(origin) && originForSender(sender) === origin;
}

function originForSender(
  sender: Browser.runtime.MessageSender,
): string | null {
  if (sender.url === undefined) return null;
  try {
    const origin = new URL(sender.url).origin;
    return isSupportedOrigin(origin) ? origin : null;
  } catch {
    return null;
  }
}
