import {
  createOpenAiQuickHintProvider,
  parseQuickHint,
} from '../src/modules/reading-flow/quick-hint-provider';
import {
  isSupportedOrigin,
  scriptIdFor,
} from '../src/modules/reading-flow/site-permission';
import type { Selection } from '../src/modules/assistance/generation-port';
import type {
  EnableSiteResponse,
  QuickHintResponse,
  ReadingFlowRequest,
} from '../src/modules/reading-flow/messages';

const readingFlowScript = '/reading-flow.js';
const focusEvent = 'lingo-palette:focus-selection-toolbar';

export default defineBackground(() => {
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
      message: ReadingFlowRequest,
      sender,
    ): Promise<EnableSiteResponse | QuickHintResponse> | undefined => {
      if (message.type === 'site-status') {
        return siteStatus(message.origin, sender);
      }
      if (message.type === 'enable-site') {
        return enableSite(message.origin, sender);
      }
      if (message.type === 'quick-hint') {
        return generateQuickHint(message.selection);
      }
      return undefined;
    },
  );
});

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
  if (!isSupportedOrigin(origin) || !senderMatchesOrigin(sender, origin)) {
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
  if (!isSupportedOrigin(origin) || !senderMatchesOrigin(sender, origin)) {
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
): Promise<QuickHintResponse> {
  const testBrowser = import.meta.env.WXT_TEST_BROWSER === 'true';
  const stored = await browser.storage.local.get(
    testBrowser
      ? ['openAiApiKey', 'quickHintTestFixture']
      : 'openAiApiKey',
  );
  if (
    testBrowser &&
    stored.quickHintTestFixture !== undefined
  ) {
    return {
      status: 'completed',
      result: parseQuickHint(stored.quickHintTestFixture),
    };
  }
  const apiKey = stored.openAiApiKey;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return { status: 'failed', message: '尚未設定 OpenAI API key。' };
  }

  try {
    const provider = createOpenAiQuickHintProvider(apiKey);
    return { status: 'completed', result: await provider.generate(selection) };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : '無法產生快速提示。',
    };
  }
}

function senderMatchesOrigin(
  sender: Browser.runtime.MessageSender,
  origin: string,
): boolean {
  if (sender.url === undefined) return false;
  try {
    return new URL(sender.url).origin === origin;
  } catch {
    return false;
  }
}

