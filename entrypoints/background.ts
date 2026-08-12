import {
  parseQuickHint,
  parseQuickHintSelection,
} from '../src/modules/reading-flow/quick-hint';
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
        return generateQuickHint(message.selection, sender);
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

  if (import.meta.env.WXT_TEST_BROWSER !== 'true') {
    return {
      status: 'failed',
      message: 'OpenAI assistance 尚未設定完成。',
    };
  }

  const stored = await browser.storage.local.get('quickHintTestFixture');
  if (stored.quickHintTestFixture === undefined) {
    return {
      status: 'failed',
      message: '受控的快速提示提供者尚未設定。',
    };
  }

  try {
    await browser.storage.local.set({
      quickHintTestRequest: providerSelection,
    });
    return {
      status: 'completed',
      result: parseQuickHint(stored.quickHintTestFixture),
    };
  } catch {
    return {
      status: 'failed',
      message: '受控的快速提示提供者傳回無效結果。',
    };
  }
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
