import { countSelectionSentences } from '../dogfood/activity-store';
import { createBrowserPronunciationPlayback } from '../pronunciation/browser-playback';
import type { PronunciationVariety } from '../pronunciation/playback';
import { createReadingFlowClient } from './reading-flow-client';
import { createReadingFlowStore } from './reading-flow-store';
import {
  captureSelection,
  SELECTION_LIMIT,
  type SelectionSnapshot,
} from './selection';
import {
  createSelectionSurface,
  type SelectionSurface,
} from './selection-surface/selection-surface';
import type { QuickHintResponse } from './messages';

const automaticQuickHintDelayMs = 1_000;
const focusEvent = 'lingo-palette:focus-selection-toolbar';
const initializedAttribute = 'data-lingo-palette-reading-flow-initialized';

export type ReadingFlow = {
  mount(): void;
  dispose(): void;
};

export function isSupportedReadingDocument(currentWindow: Window): boolean {
  if (currentWindow.top === currentWindow) return true;
  try {
    return (
      currentWindow.top !== null &&
      currentWindow.top.location.origin === currentWindow.location.origin
    );
  } catch {
    return false;
  }
}

export function createReadingFlow(
  currentWindow: Window,
  currentDocument: Document,
): ReadingFlow {
  const client = createReadingFlowClient();
  const pronunciationPlayback = createBrowserPronunciationPlayback();
  const store = createReadingFlowStore(pronunciationPlayback.getState());
  const recordedSelectionActivity = new Set<string>();
  const submittedSelectionActivity = new Set<string>();

  let mounted = false;
  let surface: SelectionSurface | null = null;
  let previousFocus: HTMLElement | null = null;
  let pendingSelectionActivity: string | null = null;
  let automaticQuickHintTimer: number | null = null;
  let quickHintRequestVersion = 0;
  let eventController: AbortController | null = null;
  let unsubscribeProgress: (() => void) | null = null;
  let unsubscribePronunciation: (() => void) | null = null;

  const actions = {
    close: () => closeSurface(true),
    enableSite: () => void enableCurrentSite(),
    requestQuickHint: () => void requestQuickHint(),
    cancelQuickHint: () => void cancelActiveQuickHint(),
    requestDeepDive: () => void requestDeepDive(),
    requestPronunciation: (variety: PronunciationVariety) =>
      void requestPronunciation(variety),
    togglePronunciationPause,
    stopPronunciation: stopPronunciationPlayback,
    expand: expandSurface,
    interact: cancelScheduledQuickHint,
  };

  function mount(): void {
    if (mounted) return;
    mounted = true;
    currentDocument.documentElement.setAttribute(initializedAttribute, '');
    surface = createSelectionSurface(currentDocument, store, actions);
    eventController = new AbortController();
    const { signal } = eventController;

    currentDocument.addEventListener(
      'pointerup',
      (event) => {
        if (surface?.ownsEvent(event) === true) return;
        const selectionStableAt = performance.now();
        queueMicrotask(() =>
          showForCurrentSelection(false, selectionStableAt, true),
        );
      },
      { signal },
    );

    currentDocument.addEventListener(
      'keyup',
      (event) => {
        const selectionKey =
          event.key === 'Shift' ||
          event.key.startsWith('Arrow') ||
          event.key === 'Home' ||
          event.key === 'End' ||
          event.key === 'PageUp' ||
          event.key === 'PageDown' ||
          ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a');
        if (
          !selectionKey ||
          event.key === 'Escape' ||
          surface?.ownsEvent(event) === true
        ) {
          return;
        }
        const selectionStableAt = performance.now();
        const selectionFinished = !event.shiftKey;
        queueMicrotask(() =>
          showForCurrentSelection(
            false,
            selectionStableAt,
            selectionFinished,
          ),
        );
      },
      { signal },
    );

    currentDocument.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key !== 'Escape' ||
          store.getState().surface.mode === 'hidden'
        ) {
          return;
        }
        event.preventDefault();
        closeSurface(true);
      },
      { signal },
    );

    currentWindow.addEventListener(
      focusEvent,
      () => {
        if (currentDocument.activeElement instanceof HTMLIFrameElement) return;
        showForCurrentSelection(true, performance.now(), false);
      },
      { signal },
    );

    unsubscribePronunciation = pronunciationPlayback.subscribe(
      (pronunciation) => store.getState().setPronunciation(pronunciation),
    );
    unsubscribeProgress = client.onProgress((progress) => {
      if (
        progress.type === 'quick-hint' &&
        store.getState().quickHint.status === 'loading'
      ) {
        store.getState().setStatusMessage(progress.message);
      } else if (progress.type === 'pronunciation') {
        pronunciationPlayback.reportProgress(
          progress.requestId,
          progress.message,
        );
      }
    });

    void client.siteStatus(currentWindow.location.origin).then((response) => {
      if (!mounted) return;
      store
        .getState()
        .setSiteAccess({ status: response.enabled ? 'enabled' : 'disabled' });
      showForCurrentSelection(false, performance.now(), false);
    });
  }

  function dispose(): void {
    if (!mounted) return;
    mounted = false;
    cancelScheduledQuickHint();
    quickHintRequestVersion += 1;
    if (store.getState().quickHint.status === 'loading') {
      void client.cancelQuickHint().catch(() => undefined);
    }
    pronunciationPlayback.reset();
    eventController?.abort();
    eventController = null;
    unsubscribeProgress?.();
    unsubscribeProgress = null;
    unsubscribePronunciation?.();
    unsubscribePronunciation = null;
    surface?.destroy();
    surface = null;
    store.getState().clearSelection();
    currentDocument.documentElement.removeAttribute(initializedAttribute);
  }

  function showForCurrentSelection(
    focusControls: boolean,
    selectionStableAt: number,
    recordActivity: boolean,
  ): void {
    const nextSnapshot = captureSelection(
      currentDocument,
      currentDocument.getSelection(),
    );
    const state = store.getState();
    const priorSnapshot = state.selection;
    if (nextSnapshot === null) {
      if (priorSnapshot !== null) closeSurface(false);
      return;
    }
    const currentFocus = activeHTMLElement(currentDocument);
    if (surface?.ownsElement(currentFocus) !== true) {
      previousFocus = currentFocus;
    }

    const activityKey = JSON.stringify(nextSnapshot.selection);
    if (
      focusControls &&
      priorSnapshot !== null &&
      JSON.stringify(priorSnapshot.selection) === activityKey
    ) {
      store.getState().expand('first-action');
      return;
    }

    if (
      recordActivity &&
      !recordedSelectionActivity.has(activityKey) &&
      !submittedSelectionActivity.has(activityKey)
    ) {
      pendingSelectionActivity = activityKey;
    }

    const enabled = state.siteAccess.status === 'enabled';
    if (enabled && pendingSelectionActivity === activityKey) {
      submitSelectionActivity(activityKey);
    }

    invalidateQuickHintRequest();
    pronunciationPlayback.reset();
    store.getState().setQuickHint({ status: 'idle' });
    store.getState().select(nextSnapshot, selectionStableAt);


    if (focusControls) {
      store.getState().expand('first-action');
      return;
    }
    if (!enabled) {
      store.getState().expand();
      return;
    }

    if (!recordActivity) {
      store.getState().reset();
      store.getState().select(nextSnapshot, selectionStableAt);
      return;
    }

    store.getState().showPeek();
    if (nextSnapshot.codePointLength <= SELECTION_LIMIT) {
      scheduleAutomaticQuickHint();
    } else {
      store.getState().setQuickHint({
        status: 'unavailable',
        message: '這段內容較長',
      });
    }
  }

  function submitSelectionActivity(activityKey: string): void {
    submittedSelectionActivity.add(activityKey);
    pendingSelectionActivity = null;
    void client
      .recordSelection()
      .then((response) => {
        if (
          typeof response === 'object' &&
          response !== null &&
          'status' in response &&
          response.status === 'recorded'
        ) {
          recordedSelectionActivity.add(activityKey);
        }
      })
      .catch(() => undefined)
      .finally(() => submittedSelectionActivity.delete(activityKey));
  }

  function expandSurface(
    target: 'first-action' | 'pronunciation',
  ): void {
    if (store.getState().selection === null) return;
    cancelScheduledQuickHint();
    store.getState().expand(target);
  }

  async function enableCurrentSite(): Promise<void> {
    store.getState().setStatusMessage('正在要求目前網站的存取權…');
    const response = await client.enableSite(currentWindow.location.origin);
    if (!response.enabled) {
      store
        .getState()
        .setStatusMessage(response.message ?? '無法啟用目前網站。');
      return;
    }
    store.getState().setSiteAccess({ status: 'enabled' });
    const snapshot = store.getState().selection;
    if (
      snapshot !== null &&
      pendingSelectionActivity === JSON.stringify(snapshot.selection)
    ) {
      submitSelectionActivity(pendingSelectionActivity);
    }
    store.getState().expand('first-action');
    store.getState().setStatusMessage('已啟用目前網站。');
    scheduleAutomaticQuickHint();
  }

  function scheduleAutomaticQuickHint(): void {
    cancelScheduledQuickHint();
    const scheduledSnapshot = store.getState().selection;
    if (
      scheduledSnapshot === null ||
      scheduledSnapshot.codePointLength > SELECTION_LIMIT
    ) {
      return;
    }
    store.getState().setQuickHint({ status: 'scheduled' });
    automaticQuickHintTimer = currentWindow.setTimeout(() => {
      automaticQuickHintTimer = null;
      if (
        store.getState().selection !== scheduledSnapshot ||
        store.getState().quickHint.status === 'loading'
      ) {
        return;
      }
      void requestQuickHint();
    }, automaticQuickHintDelayMs);
  }

  function cancelScheduledQuickHint(): void {
    if (automaticQuickHintTimer === null) return;
    currentWindow.clearTimeout(automaticQuickHintTimer);
    automaticQuickHintTimer = null;
    if (store.getState().quickHint.status === 'scheduled') {
      store.getState().setQuickHint({ status: 'idle' });
    }
  }

  function invalidateQuickHintRequest(): void {
    cancelScheduledQuickHint();
    quickHintRequestVersion += 1;
    if (store.getState().quickHint.status === 'loading') {
      void client.cancelQuickHint().catch(() => undefined);
      store.getState().setQuickHint({ status: 'idle' });
    }
  }

  async function requestQuickHint(): Promise<void> {
    cancelScheduledQuickHint();
    const requestedSnapshot = store.getState().selection;
    if (
      requestedSnapshot === null ||
      requestedSnapshot.codePointLength > SELECTION_LIMIT ||
      store.getState().quickHint.status === 'loading'
    ) {
      return;
    }
    const requestedVersion = quickHintRequestVersion;
    store.getState().setQuickHint({ status: 'loading' });
    store.getState().setStatusMessage('正在產生快速提示…');

    let response: QuickHintResponse;
    try {
      response = await client.requestQuickHint(requestedSnapshot.selection);
    } catch {
      if (quickHintRequestVersion === requestedVersion) {
        const message = '無法連線到 Lingo Palette。';
        store.getState().setStatusMessage(message);
        store.getState().setQuickHint({ status: 'failed', message });
      }
      return;
    }

    if (
      quickHintRequestVersion !== requestedVersion ||
      store.getState().selection !== requestedSnapshot
    ) {
      return;
    }
    if (response.status === 'failed') {
      store.getState().setStatusMessage(response.message);
      store.getState().setQuickHint({
        status: 'failed',
        message: response.message,
      });
      return;
    }
    if (response.status === 'cancelled') {
      store.getState().setStatusMessage(response.message);
      store.getState().setQuickHint({
        status: 'cancelled',
        message: response.message,
      });
      return;
    }
    store.getState().setStatusMessage(completedStatus(response));
    store.getState().setQuickHint({
      status: 'ready',
      simplerExpression: response.result.simplerExpression,
      explanationCue: response.result.explanationCue,
    });
  }

  async function cancelActiveQuickHint(): Promise<void> {
    if (store.getState().quickHint.status !== 'loading') return;
    quickHintRequestVersion += 1;
    store.getState().setStatusMessage('正在取消快速提示…');
    try {
      const response = await client.cancelQuickHint();
      if (response.status === 'completed') {
        store.getState().setStatusMessage(completedStatus(response));
        store.getState().setQuickHint({
          status: 'ready',
          simplerExpression: response.result.simplerExpression,
          explanationCue: response.result.explanationCue,
        });
      } else {
        store.getState().setStatusMessage(response.message);
        store.getState().setQuickHint({
          status:
            response.status === 'failed' ? 'failed' : 'cancelled',
          message: response.message,
        });
      }
    } catch {
      const message = '已取消 Quick Hint；Selection 仍保留。';
      store.getState().setStatusMessage(message);
      store.getState().setQuickHint({ status: 'cancelled', message });
    }
  }

  async function requestDeepDive(): Promise<void> {
    invalidateQuickHintRequest();
    const snapshot = store.getState().selection;
    if (snapshot === null || snapshot.codePointLength > SELECTION_LIMIT) return;
    store.getState().setStatusMessage('正在開啟 Deep Dive…');
    try {
      const response = await client.requestDeepDive(snapshot.selection);
      store.getState().setStatusMessage(
        response.status === 'started'
          ? 'Deep Dive 已在 Side Panel 開始；目前 Selection 會保留到完成、失敗或取消。'
          : response.status === 'loaded'
            ? 'Deep Dive Side Panel 已更新。'
            : response.message,
      );
    } catch {
      store
        .getState()
        .setStatusMessage('無法開啟 Deep Dive Side Panel；Selection 仍保留。');
    }
  }

  async function requestPronunciation(
    variety: PronunciationVariety,
  ): Promise<void> {
    const snapshot = store.getState().selection;
    if (snapshot === null) return;
    invalidateQuickHintRequest();
    const selectionText = snapshot.selection.text;
    await pronunciationPlayback.start(selectionText, variety);
    if (pronunciationPlayback.getState().status !== 'completed') return;
    void client
      .recordPronunciation(
        variety,
        countSelectionSentences(selectionText),
      )
      .catch(() => undefined);
  }

  function togglePronunciationPause(): void {
    const pronunciation = store.getState().pronunciation;
    if (pronunciation.status === 'paused') {
      pronunciationPlayback.resume();
    } else if (
      pronunciation.status === 'discovering' ||
      pronunciation.status === 'generating' ||
      pronunciation.status === 'playing'
    ) {
      pronunciationPlayback.pause();
    }
  }

  function stopPronunciationPlayback(): void {
    const status = store.getState().pronunciation.status;
    if (
      status === 'idle' ||
      status === 'stopped' ||
      status === 'completed' ||
      status === 'failed'
    ) {
      return;
    }
    pronunciationPlayback.stop();
  }

  function closeSurface(restoreFocus: boolean): void {
    invalidateQuickHintRequest();
    pronunciationPlayback.reset();
    store.getState().clearSelection();
    if (restoreFocus && previousFocus?.isConnected === true) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  return { mount, dispose };
}

function activeHTMLElement(currentDocument: Document): HTMLElement | null {
  return currentDocument.activeElement instanceof HTMLElement
    ? currentDocument.activeElement
    : null;
}

function completedStatus(
  response: Extract<QuickHintResponse, { status: 'completed' }>,
): string {
  if (response.source === 'cache') {
    return '快速提示已從本機快取載入；未使用 provider budget。';
  }
  if (response.usage === null) return '快速提示已完成。';
  const cost =
    response.usage.estimatedCostUsd === null
      ? '此模型沒有本機價格估算'
      : `估算 US$${response.usage.estimatedCostUsd.toFixed(6)}`;
  return `快速提示已完成；第 ${response.attempts} 次 provider 嘗試成功，共 ${response.usage.totalTokens.toLocaleString('en-US')} tokens（input ${response.usage.inputTokens.toLocaleString('en-US')}，cached input ${response.usage.cachedInputTokens.toLocaleString('en-US')}，output ${response.usage.outputTokens.toLocaleString('en-US')}，reasoning ${response.usage.reasoningTokens.toLocaleString('en-US')}），${cost}。`;
}
