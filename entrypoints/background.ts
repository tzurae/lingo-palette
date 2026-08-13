import { z } from 'zod';
import {
  createOpenAiConfigurationStore,
  validateOpenAiConfiguration,
} from '../src/modules/openai/configuration-store';
import type {
  OpenAiSettingsRequest,
  OpenAiSettingsResponse,
} from '../src/modules/openai/messages';
import {
  createOpenAiResponsesClient,
  OpenAiCompatibilityError,
  OpenAiProviderError,
} from '../src/modules/openai/openai-responses';
import { parseQuickHintSelection } from '../src/modules/reading-flow/quick-hint';
import {
  isSupportedOrigin,
  scriptIdFor,
} from '../src/modules/reading-flow/site-permission';
import type { Selection } from '../src/modules/reading-flow/selection';
import type {
  EnableSiteResponse,
  QuickHintResponse,
  ReadingFlowRequest,
} from '../src/modules/reading-flow/messages';

const readingFlowScript = '/reading-flow.js';
const focusEvent = 'lingo-palette:focus-selection-toolbar';
const openAiConfigurationStore = createOpenAiConfigurationStore(
  browser.storage.local,
);
const controlledResponseQueueSchema = z.array(
  z.object({ status: z.number().int(), body: z.unknown() }),
);
const controlledRequestSchema = z.object({
  text: z.object({ format: z.object({ name: z.string() }) }),
});
const openAiResponsesClient = createOpenAiResponsesClient(
  import.meta.env.WXT_TEST_BROWSER === 'true' ? controlledOpenAiFetch : fetch,
);

export default defineBackground(() => {
  void initializeBackground();
});

async function initializeBackground(): Promise<void> {
  await browser.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
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
          EnableSiteResponse | QuickHintResponse | OpenAiSettingsResponse
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
    providerSelection = parseQuickHintSelection(selection);
  } catch {
    return {
      status: 'failed',
      message: '選取內容超過快速提示可接受的範圍。',
    };
  }

  const runtime = await openAiConfigurationStore.loadRuntimeConfiguration();
  if (runtime === null) {
    return {
      status: 'failed',
      message: '請先在 Settings 儲存 OpenAI API key。',
    };
  }

  try {
    if (import.meta.env.WXT_TEST_BROWSER === 'true') {
      await browser.storage.local.set({
        quickHintTestRequest: providerSelection,
      });
    }
    const generated = await openAiResponsesClient.generateQuickHint({
      apiKey: runtime.apiKey,
      configuration: runtime.configuration,
      selection: providerSelection,
    });
    return { status: 'completed', result: generated.result };
  } catch (error) {
    return {
      status: 'failed',
      message:
        error instanceof Error
          ? error.message
          : 'OpenAI assistance 無法產生 Quick Hint。',
    };
  }
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
        settings: await openAiConfigurationStore.loadSettings(),
      };
    }
    if (message.type === 'remove-openai-api-key') {
      await openAiConfigurationStore.removeApiKey();
      return {
        status: 'key-removed',
        settings: await openAiConfigurationStore.loadSettings(),
      };
    }

    const configuration = validateOpenAiConfiguration(message.configuration);
    const current = await openAiConfigurationStore.loadRuntimeConfiguration();
    const apiKey = message.apiKey ?? current?.apiKey;
    if (apiKey === undefined || apiKey.length === 0) {
      return {
        status: 'failed',
        message: '請輸入 OpenAI API key；既有 key 不會顯示或匯出。',
      };
    }

    const probes =
      configuration.model.kind === 'custom'
        ? await openAiResponsesClient.probeAndReport({
            apiKey,
            configuration,
          })
        : [];
    await openAiConfigurationStore.activate(configuration, message.apiKey);
    return {
      status: 'activated',
      settings: await openAiConfigurationStore.loadSettings(),
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
    return Response.json(next.body, { status: next.status });
  }

  const output =
    request.text.format.name === 'quick_hint'
      ? stored.quickHintTestFixture
      : { compatible: true };
  return Response.json({
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(output) }],
      },
    ],
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
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
