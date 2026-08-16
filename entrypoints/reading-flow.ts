import { fitAnchoredSurface } from '../src/modules/reading-flow/anchored-surface';
import {
  captureSelection,
  SELECTION_LIMIT,
  type SelectionSnapshot,
} from '../src/modules/reading-flow/selection';
import {
  conservativeTokenCount,
  createPronunciationPlayback,
  selectExactLocalVoice,
  type LocalVoice,
  type PronunciationPlayback,
  type PronunciationPlaybackState,
  type PronunciationVariety,
  type RemoteAudio,
  type VoiceDiscovery,
} from '../src/modules/pronunciation/playback';
import type {
  DeepDiveResponse,
  EnableSiteResponse,
  QuickHintResponse,
  PronunciationAudioResponse,
} from '../src/modules/reading-flow/messages';

const hostAttribute = 'data-lingo-palette-reading-flow';
const initializedAttribute = 'data-lingo-palette-reading-flow-initialized';
const focusEvent = 'lingo-palette:focus-selection-toolbar';
const viewportGap = 8;

export default defineUnlistedScript(() => {
  if (!isSupportedReadingDocument(window)) return;
  if (!document.documentElement.hasAttribute(initializedAttribute)) {
    document.documentElement.setAttribute(initializedAttribute, '');
    startReadingFlow();
  }
});

function isSupportedReadingDocument(currentWindow: Window): boolean {
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

function startReadingFlow(): void {
  let snapshot: SelectionSnapshot | null = null;
  let previousFocus: HTMLElement | null = null;
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let enabled = false;
  let visibilityMeasurementVersion = 0;
  let quickHintRequestVersion = 0;
  let quickHintBusy = false;
  const pronunciationPlayback = createBrowserPronunciationPlayback();
  let pronunciationState = pronunciationPlayback.getState();
  pronunciationPlayback.subscribe((state) => {
    pronunciationState = state;
    renderPronunciationState();
  });

  void browser.runtime
    .sendMessage({ type: 'site-status', origin: location.origin })
    .then((response: EnableSiteResponse) => {
      enabled = response.enabled;
      showForCurrentSelection(false, performance.now());
    });

  document.addEventListener('pointerup', (event) => {
    if (host !== null && event.composedPath().includes(host)) return;
    const selectionStableAt = performance.now();
    queueMicrotask(() => showForCurrentSelection(false, selectionStableAt));
  });
  document.addEventListener('keyup', (event) => {
    if (
      event.key === 'Escape' ||
      (host !== null && event.composedPath().includes(host))
    ) {
      return;
    }
    const selectionStableAt = performance.now();
    queueMicrotask(() => showForCurrentSelection(false, selectionStableAt));
  });
  window.addEventListener(focusEvent, () => {
    if (document.activeElement instanceof HTMLIFrameElement) return;
    showForCurrentSelection(true, performance.now());
  });
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      !('message' in message) ||
      typeof message.message !== 'string'
    ) {
      return;
    }
    if (quickHintBusy && message.type === 'quick-hint-progress') {
      setStatus(message.message);
    }
    if (
      message.type === 'pronunciation-progress' &&
      'requestId' in message &&
      typeof message.requestId === 'string'
    ) {
      pronunciationPlayback.reportProgress(
        message.requestId,
        message.message,
      );
    }
  });
  window.addEventListener('scroll', placeSurface, true);
  window.addEventListener('resize', placeSurface);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || host === null) return;
    event.preventDefault();
    closeSurface(true);
  });

  function showForCurrentSelection(
    focusControls: boolean,
    selectionStableAt: number,
  ): void {
    const nextSnapshot = captureSelection(document, document.getSelection());
    if (nextSnapshot === null) {
      if (focusControls) setStatus('請先選取要理解的英文內容。');
      return;
    }

    invalidateQuickHintRequest();
    pronunciationPlayback.reset();
    snapshot = nextSnapshot;
    const currentFocus = activeHTMLElement(document);
    if (currentFocus !== host) previousFocus = currentFocus;
    ensureSurface();
    renderControls();
    placeSurface();
    recordVisibleControlsFrame(selectionStableAt);
    if (focusControls) {
      firstInteractiveElement()?.focus({ preventScroll: true });
    }
  }

  function recordVisibleControlsFrame(selectionStableAt: number): void {
    const measuredHost = host;
    if (measuredHost === null) return;
    const measurementVersion = ++visibilityMeasurementVersion;
    requestAnimationFrame((visibleAt) => {
      if (
        host !== measuredHost ||
        measurementVersion !== visibilityMeasurementVersion
      ) {
        return;
      }
      measuredHost.dataset.selectionStableAt = String(selectionStableAt);
      measuredHost.dataset.visibleAt = String(visibleAt);
    });
  }

  function ensureSurface(): void {
    if (host !== null) return;
    host = document.createElement('div');
    host.setAttribute(hostAttribute, '');
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.maxWidth = 'min(360px, calc(100vw - 16px))';
    host.style.colorScheme = 'light';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.append(createStyles(), document.createElement('section'));
    document.documentElement.append(host);
  }

  function renderControls(): void {
    if (shadow === null || snapshot === null) return;
    const section = shadow.querySelector('section');
    if (section === null) return;
    section.replaceChildren();
    section.setAttribute('role', 'toolbar');
    section.setAttribute('aria-label', 'Lingo Palette 選取工具');

    const header = createElement('div', 'header');
    header.append(
      createElement('strong', undefined, 'Lingo Palette'),
      closeButton(),
    );
    section.append(header);

    const selectionLength = snapshot.codePointLength;
    section.append(
      createElement(
        'p',
        'selection-summary',
        `已選取 ${selectionLength.toLocaleString('en-US')} 個字元`,
      ),
    );

    if (!enabled) {
      const enableButton = createElement(
        'button',
        'primary',
        '在此網站啟用 Lingo Palette',
      );
      enableButton.addEventListener('click', () => void enableCurrentSite());
      section.append(enableButton, liveRegion());
      return;
    }

    const quickHint = createElement(
      'button',
      'primary quick-hint',
      '快速提示',
    );
    quickHint.disabled = selectionLength > SELECTION_LIMIT;
    quickHint.addEventListener('click', () => {
      if (quickHintBusy) {
        void cancelActiveQuickHint();
        return;
      }
      void requestQuickHint();
    });
    const deepDive = createElement(
      'button',
      'secondary deep-dive',
      'Deep Dive',
    );
    deepDive.disabled = selectionLength > SELECTION_LIMIT;
    deepDive.addEventListener('click', () => void requestDeepDive());
    section.append(quickHint, deepDive);

    const pronunciation = createElement('div', 'pronunciation');
    pronunciation.setAttribute('role', 'group');
    pronunciation.setAttribute('aria-label', 'Pronunciation Playback');
    pronunciation.append(
      createElement('strong', 'pronunciation-title', 'Pronunciation'),
    );
    const varieties = createElement('div', 'pronunciation-varieties');
    for (const [variety, label] of [
      ['en-US', 'US English'],
      ['en-GB', 'UK English'],
    ] as const) {
      const button = createElement(
        'button',
        `secondary pronunciation-variety pronunciation-${variety}`,
        label,
      );
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => void requestPronunciation(variety));
      varieties.append(button);
    }
    const playbackControls = createElement(
      'div',
      'pronunciation-playback-controls',
    );
    const pause = createElement(
      'button',
      'secondary pronunciation-pause',
      '暫停',
    );
    pause.hidden = true;
    pause.addEventListener('click', togglePronunciationPause);
    const stop = createElement(
      'button',
      'secondary pronunciation-stop',
      '停止',
    );
    stop.hidden = true;
    stop.addEventListener('click', stopPronunciationPlayback);
    playbackControls.append(pause, stop);
    const progress = document.createElement('progress');
    progress.className = 'pronunciation-progress';
    progress.hidden = true;
    const pronunciationStatus = createElement(
      'p',
      'pronunciation-status',
      pronunciationState.message,
    );
    pronunciationStatus.setAttribute('aria-live', 'polite');
    pronunciation.append(
      varieties,
      playbackControls,
      progress,
      pronunciationStatus,
    );
    section.append(pronunciation);
    renderPronunciationState();

    if (selectionLength > SELECTION_LIMIT) {
      section.append(
        createElement(
          'p',
          'error',
          `選取內容有 ${selectionLength.toLocaleString('en-US')} 個字元，超過 Quick Hint 與 Deep Dive 的 4,000 個字元上限；Pronunciation Playback 仍可使用，內容不會被截斷。`,
        ),
      );
    }
    section.append(liveRegion());
  }

  async function requestPronunciation(
    variety: PronunciationVariety,
  ): Promise<void> {
    if (snapshot === null) return;
    await pronunciationPlayback.start(snapshot.selection.text, variety);
  }

  function togglePronunciationPause(): void {
    if (pronunciationState.status === 'paused') {
      pronunciationPlayback.resume();
      return;
    }
    if (
      pronunciationState.status === 'discovering' ||
      pronunciationState.status === 'generating' ||
      pronunciationState.status === 'playing'
    ) {
      pronunciationPlayback.pause();
    }
  }

  function stopPronunciationPlayback(): void {
    if (
      pronunciationState.status === 'idle' ||
      pronunciationState.status === 'stopped' ||
      pronunciationState.status === 'completed' ||
      pronunciationState.status === 'failed'
    ) {
      return;
    }
    pronunciationPlayback.stop();
  }

  function renderPronunciationState(): void {
    if (shadow === null) return;
    const active =
      pronunciationState.status === 'discovering' ||
      pronunciationState.status === 'generating' ||
      pronunciationState.status === 'playing' ||
      pronunciationState.status === 'paused';
    for (const variety of ['en-US', 'en-GB'] as const) {
      const button = shadow.querySelector<HTMLButtonElement>(
        `.pronunciation-${variety}`,
      );
      button?.setAttribute(
        'aria-pressed',
        String(pronunciationState.variety === variety && active),
      );
    }
    const pause =
      shadow.querySelector<HTMLButtonElement>('.pronunciation-pause');
    const revealed = pronunciationState.variety !== null;
    if (pause !== null) {
      pause.hidden = !revealed;
      pause.setAttribute('aria-disabled', String(!active));
      pause.textContent =
        pronunciationState.status === 'paused' ? '繼續' : '暫停';
    }
    const stop =
      shadow.querySelector<HTMLButtonElement>('.pronunciation-stop');
    if (stop !== null) {
      stop.hidden = !revealed;
      stop.setAttribute('aria-disabled', String(!active));
    }
    const progress =
      shadow.querySelector<HTMLProgressElement>('.pronunciation-progress');
    if (progress !== null) {
      progress.hidden = pronunciationState.totalCharacters === 0;
      progress.max = Math.max(1, pronunciationState.totalCharacters);
      progress.value = pronunciationState.completedCharacters;
      progress.setAttribute(
        'aria-label',
        `Pronunciation Playback ${pronunciationState.currentChunk}/${pronunciationState.totalChunks} 段`,
      );
    }
    setPronunciationStatus(pronunciationState.message);
  }

  function setPronunciationStatus(message: string): void {
    const status =
      shadow?.querySelector<HTMLElement>('.pronunciation-status');
    if (status !== null && status !== undefined) status.textContent = message;
  }
  async function enableCurrentSite(): Promise<void> {
    setStatus('正在要求目前網站的存取權…');
    const response = (await browser.runtime.sendMessage({
      type: 'enable-site',
      origin: location.origin,
    })) as EnableSiteResponse;
    if (!response.enabled) {
      setStatus(response.message ?? '無法啟用目前網站。');
      return;
    }
    enabled = true;
    renderControls();
    placeSurface();
    firstInteractiveElement()?.focus({ preventScroll: true });
    setStatus('已啟用目前網站。');
  }

  function invalidateQuickHintRequest(): void {
    quickHintRequestVersion += 1;
    if (quickHintBusy) {
      void browser.runtime.sendMessage({ type: 'cancel-quick-hint' });
    }
    quickHintBusy = false;
  }

  async function requestQuickHint(): Promise<void> {
    if (
      snapshot === null ||
      snapshot.codePointLength > SELECTION_LIMIT ||
      quickHintBusy
    ) {
      return;
    }
    const requestedSnapshot = snapshot;
    const requestedQuickHintVersion = quickHintRequestVersion;
    quickHintBusy = true;
    setBusy(true);
    setStatus('正在產生快速提示…');

    let response: QuickHintResponse;
    try {
      response = (await browser.runtime.sendMessage({
        type: 'quick-hint',
        selection: requestedSnapshot.selection,
      })) as QuickHintResponse;
    } catch {
      if (quickHintRequestVersion === requestedQuickHintVersion) {
        quickHintBusy = false;
        setBusy(false);
        setStatus('無法連線到 Lingo Palette。');
      }
      return;
    }

    if (
      quickHintRequestVersion !== requestedQuickHintVersion ||
      snapshot !== requestedSnapshot
    ) {
      return;
    }
    quickHintBusy = false;
    setBusy(false);
    if (response.status === 'failed' || response.status === 'cancelled') {
      setStatus(response.message);
      return;
    }

    if (shadow === null) return;
    const section = shadow.querySelector('section');
    if (section === null) return;
    section.querySelector('[data-result]')?.remove();
    const result = createElement('div', 'result');
    result.dataset.result = '';
    result.append(
      createElement('strong', undefined, response.result.simplerExpression),
    );
    if (response.result.explanationCue !== null) {
      result.append(
        createElement('span', undefined, response.result.explanationCue),
      );
    }
    section.insertBefore(result, section.querySelector('[role="status"]'));
    setStatus(completedStatus(response));
    placeSurface();
  }

  async function cancelActiveQuickHint(): Promise<void> {
    if (!quickHintBusy) return;
    quickHintRequestVersion += 1;
    quickHintBusy = false;
    setBusy(false);
    setStatus('正在取消快速提示…');
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'cancel-quick-hint',
      })) as QuickHintResponse;
      setStatus(
        response.status === 'completed'
          ? '快速提示已完成。'
          : response.message,
      );
    } catch {
      setStatus('已取消 Quick Hint；Selection 仍保留。');
    }
  }

  async function requestDeepDive(): Promise<void> {
    if (
      snapshot === null ||
      snapshot.codePointLength > SELECTION_LIMIT
    ) {
      return;
    }
    setStatus('正在開啟 Deep Dive…');
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'start-deep-dive',
        selection: snapshot.selection,
      })) as DeepDiveResponse;
      setStatus(
        response.status === 'started'
          ? 'Deep Dive 已在 Side Panel 開始；目前 Selection 會保留到完成、失敗或取消。'
          : response.status === 'loaded'
            ? 'Deep Dive Side Panel 已更新。'
            : response.message,
      );
    } catch {
      setStatus('無法開啟 Deep Dive Side Panel；Selection 仍保留。');
    }
  }

  function closeSurface(restoreFocus: boolean): void {
    invalidateQuickHintRequest();
    pronunciationPlayback.reset();
    host?.remove();
    host = null;
    shadow = null;
    snapshot = null;
    if (restoreFocus && previousFocus?.isConnected === true) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  function placeSurface(): void {
    if (host === null || snapshot === null) return;
    const currentRect = snapshot.range.getBoundingClientRect();
    if (currentRect.width === 0 && currentRect.height === 0) return;
    const surfaceRect = host.getBoundingClientRect();
    const placement = fitAnchoredSurface(
      currentRect,
      {
        width: Math.max(surfaceRect.width, 280),
        height: Math.max(surfaceRect.height, 80),
      },
      { width: window.innerWidth, height: window.innerHeight },
      viewportGap,
    );
    host.style.left = `${placement.left}px`;
    host.style.top = `${placement.top}px`;
  }

  function closeButton(): HTMLButtonElement {
    const button = createElement('button', 'close', '關閉');
    button.setAttribute('aria-label', '關閉 Lingo Palette');
    button.addEventListener('click', () => closeSurface(true));
    return button;
  }

  function liveRegion(): HTMLParagraphElement {
    const status = createElement('p', 'status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    return status;
  }

  function setStatus(message: string): void {
    const status = shadow?.querySelector<HTMLElement>('.status');
    if (status !== null && status !== undefined) status.textContent = message;
  }

  function announce(message: string): void {
    setStatus(message);
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

  function setBusy(busy: boolean): void {
    const section = shadow?.querySelector<HTMLElement>('section');
    section?.setAttribute('aria-busy', String(busy));
    const button =
      shadow?.querySelector<HTMLButtonElement>('.quick-hint');
    if (button !== null && button !== undefined) {
      button.textContent = busy ? '取消快速提示' : '快速提示';
    }
  }

  function firstInteractiveElement(): HTMLButtonElement | null {
    return (
      shadow?.querySelector<HTMLButtonElement>('.primary:not(:disabled)') ??
      shadow?.querySelector<HTMLButtonElement>('.close') ??
      null
    );
  }
}

function activeHTMLElement(document: Document): HTMLElement | null {
  return document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createBrowserPronunciationPlayback(): PronunciationPlayback {
  let activeAudio: HTMLAudioElement | null = null;
  let activeAudioUrl: string | null = null;
  const voices = createBrowserVoiceDiscovery();

  return createPronunciationPlayback({
    countTokens: conservativeTokenCount,
    voices,
    local: {
      play(text, selectedVoice, signal) {
        return playWithSpeechSynthesis(text, selectedVoice, signal);
      },
      pause() {
        speechSynthesis.pause();
      },
      resume() {
        speechSynthesis.resume();
      },
      stop() {
        speechSynthesis.cancel();
      },
    },
    remote: {
      async load(request, signal) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = (await browser.runtime.sendMessage({
          type: 'pronunciation-audio',
          requestId: request.requestId,
          selection: {
            text: request.text,
            context: { before: '', after: '' },
          },
          variety: request.variety,
        })) as PronunciationAudioResponse;
        if (signal.aborted || response.status === 'cancelled') {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (response.status === 'failed') throw new Error(response.message);
        return {
          ...response.audio,
          usage: response.usage,
          attempts: response.attempts,
        };
      },
      play(audio, signal) {
        if (signal.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        if (import.meta.env.WXT_TEST_BROWSER === 'true') {
          return Promise.resolve();
        }
        const bytes = decodeBase64(audio.audioBase64);
        activeAudioUrl = URL.createObjectURL(
          new Blob([bytes], { type: audio.mimeType }),
        );
        activeAudio = new Audio(activeAudioUrl);
        const playing = activeAudio;
        const url = activeAudioUrl;
        const completion = Promise.withResolvers<void>();
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', aborted);
          playing.onended = null;
          playing.onerror = null;
          URL.revokeObjectURL(url);
          if (activeAudio === playing) {
            activeAudio = null;
            activeAudioUrl = null;
          }
          if (error === undefined) completion.resolve();
          else completion.reject(error);
        };
        const aborted = () => {
          playing.pause();
          playing.currentTime = 0;
          finish(new DOMException('Aborted', 'AbortError'));
        };
        playing.onended = () => finish();
        playing.onerror = () =>
          finish(new Error('瀏覽器無法播放已產生的 Pronunciation audio。'));
        signal.addEventListener('abort', aborted, { once: true });
        void playing.play().catch((error: unknown) => {
          finish(
            error instanceof Error
              ? error
              : new Error('瀏覽器無法開始 Pronunciation audio。'),
          );
        });
        return completion.promise;
      },
      async cancel(requestId) {
        await browser.runtime
          .sendMessage({
            type: 'cancel-pronunciation-audio',
            requestId,
          })
          .catch(() => undefined);
      },
      pause() {
        activeAudio?.pause();
      },
      resume() {
        void activeAudio?.play().catch(() => undefined);
      },
      stop() {
        activeAudio?.pause();
        if (activeAudio !== null) activeAudio.currentTime = 0;
      },
    },
    id: () => crypto.randomUUID(),
  });
}

function createBrowserVoiceDiscovery(): VoiceDiscovery {
  if (import.meta.env.WXT_TEST_BROWSER === 'true') {
    const genericVoice: LocalVoice = {
      id: 'generic-browser-test-voice',
      lang: 'en',
      localService: true,
      name: 'Generic browser test voice',
      default: true,
    };
    return {
      getVoices: () => [genericVoice],
      waitForVoices: async () => {},
    };
  }
  return {
    getVoices: browserLocalVoices,
    waitForVoices(variety, signal) {
      if (selectExactLocalVoice(browserLocalVoices(), variety) !== null) {
        return Promise.resolve();
      }
      const completion = Promise.withResolvers<void>();
      let timeout: number | null = null;
      const cleanup = () => {
        speechSynthesis.removeEventListener('voiceschanged', changed);
        signal.removeEventListener('abort', aborted);
        if (timeout !== null) window.clearTimeout(timeout);
      };
      const changed = () => {
        if (selectExactLocalVoice(browserLocalVoices(), variety) === null) return;
        cleanup();
        completion.resolve();
      };
      const aborted = () => {
        cleanup();
        completion.reject(new DOMException('Aborted', 'AbortError'));
      };
      speechSynthesis.addEventListener('voiceschanged', changed);
      signal.addEventListener('abort', aborted, { once: true });
      timeout = window.setTimeout(() => {
        cleanup();
        completion.resolve();
      }, 2_000);
      return completion.promise;
    },
  };
}

function browserLocalVoices(): LocalVoice[] {
  return speechSynthesis.getVoices().map((voice) => ({
    id: browserVoiceId(voice),
    lang: voice.lang,
    localService: voice.localService,
    name: voice.name,
    default: voice.default,
  }));
}

function playWithSpeechSynthesis(
  text: string,
  selectedVoice: LocalVoice,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  const voice =
    speechSynthesis
      .getVoices()
      .find((candidate) => browserVoiceId(candidate) === selectedVoice.id) ??
    null;
  if (voice === null) {
    return Promise.reject(
      new Error(`本機 ${selectedVoice.lang} voice 已無法使用。`),
    );
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = selectedVoice.lang;
  const completion = Promise.withResolvers<void>();
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    signal.removeEventListener('abort', aborted);
    utterance.onend = null;
    utterance.onerror = null;
    if (error === undefined) completion.resolve();
    else completion.reject(error);
  };
  const aborted = () => {
    speechSynthesis.cancel();
    finish(new DOMException('Aborted', 'AbortError'));
  };
  utterance.onend = () => finish();
  utterance.onerror = (event) =>
    finish(new Error(`本機 Pronunciation Playback 失敗：${event.error}。`));
  signal.addEventListener('abort', aborted, { once: true });
  speechSynthesis.speak(utterance);
  return completion.promise;
}

function browserVoiceId(voice: SpeechSynthesisVoice): string {
  return voice.voiceURI.length > 0
    ? voice.voiceURI
    : `${voice.name}\u0000${voice.lang}`;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    :host { font: 14px/1.45 system-ui, sans-serif; }
    section { box-sizing: border-box; width: 320px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto; padding: 12px; border: 1px solid #475569; border-radius: 10px; background: #fff; color: #172033; box-shadow: 0 8px 28px rgb(15 23 42 / 24%); }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .selection-summary, .status, .error { margin: 8px 0 0; }
    button { min-height: 36px; border: 1px solid #475569; border-radius: 7px; background: #fff; color: #172033; cursor: pointer; font: inherit; }
    button:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
    button:disabled, button[aria-disabled="true"] { cursor: not-allowed; opacity: .58; }
    .primary { width: 100%; margin-top: 10px; background: #1d4ed8; color: #fff; border-color: #1d4ed8; font-weight: 700; }
    .secondary { width: 100%; margin-top: 8px; background: #fff; color: #172033; font-weight: 700; }
    .close { min-width: 48px; }
    .error { color: #991b1b; font-weight: 650; }
    .result { display: grid; gap: 4px; margin-top: 10px; padding: 10px; border-radius: 7px; background: #eff6ff; }
    .pronunciation { display: grid; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #cbd5e1; }
    .pronunciation-title { font-size: 13px; }
    .pronunciation-varieties, .pronunciation-playback-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .pronunciation .secondary { margin-top: 0; }
    .pronunciation-variety[aria-pressed="true"] { background: #dbeafe; border-color: #1d4ed8; }
    .pronunciation-progress { width: 100%; accent-color: #1d4ed8; }
    .pronunciation-status { margin: 0; color: #334155; font-size: 12px; }
    @media (prefers-reduced-motion: no-preference) { section { animation: lingo-palette-in 100ms ease-out; } }
    @keyframes lingo-palette-in { from { opacity: 0; transform: translateY(3px); } }
    @media (forced-colors: active) { section, button { border: 2px solid ButtonText; } }
  `;
  return style;
}
