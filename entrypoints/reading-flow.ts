import {
  captureSelection,
  fitAnchoredSurface,
  SELECTION_LIMIT,
  type SelectionSnapshot,
} from '../src/modules/reading-flow/selection';
import type {
  EnableSiteResponse,
  QuickHintResponse,
} from '../src/modules/reading-flow/messages';

const hostAttribute = 'data-lingo-palette-reading-flow';
const initializedAttribute = 'data-lingo-palette-reading-flow-initialized';
const focusEvent = 'lingo-palette:focus-selection-toolbar';
const viewportGap = 8;

export default defineUnlistedScript(() => {
  if (!document.documentElement.hasAttribute(initializedAttribute)) {
    document.documentElement.setAttribute(initializedAttribute, '');
    startReadingFlow();
  }
});

function startReadingFlow(): void {
  let snapshot: SelectionSnapshot | null = null;
  let previousFocus: HTMLElement | null = null;
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let enabled = false;

  void browser.runtime
    .sendMessage({ type: 'site-status', origin: location.origin })
    .then((response: EnableSiteResponse) => {
      enabled = response.enabled;
      showForCurrentSelection(false);
    });

  document.addEventListener('pointerup', (event) => {
    if (host !== null && event.composedPath().includes(host)) return;
    queueMicrotask(() => showForCurrentSelection(false));
  });
  document.addEventListener('keyup', (event) => {
    if (
      event.key === 'Escape' ||
      (host !== null && event.composedPath().includes(host))
    ) {
      return;
    }
    queueMicrotask(() => showForCurrentSelection(false));
  });
  window.addEventListener(
    focusEvent,
    () => showForCurrentSelection(true),
  );
  window.addEventListener('scroll', placeSurface, true);
  window.addEventListener('resize', placeSurface);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || host === null) return;
    event.preventDefault();
    closeSurface(true);
  });

  function showForCurrentSelection(focusControls: boolean): void {
    const nextSnapshot = captureSelection(document, document.getSelection());
    if (nextSnapshot === null) {
      if (focusControls) announce('請先選取要理解的英文內容。');
      return;
    }

    snapshot = nextSnapshot;
    previousFocus = activeHTMLElement(document);
    ensureSurface();
    renderControls();
    placeSurface();
    if (focusControls) {
      firstInteractiveElement()?.focus({ preventScroll: true });
    }
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
    if (host !== null) host.dataset.visibleAt = String(performance.now());

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

    const quickHint = createElement('button', 'primary', '快速提示');
    quickHint.disabled = selectionLength > SELECTION_LIMIT;
    quickHint.addEventListener('click', () => void requestQuickHint());
    section.append(quickHint);

    if (selectionLength > SELECTION_LIMIT) {
      section.append(
        createElement(
          'p',
          'error',
          `選取內容有 ${selectionLength.toLocaleString('en-US')} 個字元，超過 4,000 個字元上限。請縮短選取內容；內容不會被截斷。`,
        ),
      );
    }
    section.append(liveRegion());
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
    announce('已啟用目前網站。');
  }

  async function requestQuickHint(): Promise<void> {
    if (snapshot === null || snapshot.codePointLength > SELECTION_LIMIT) return;
    setBusy(true);
    setStatus('正在產生快速提示…');
    const response = (await browser.runtime.sendMessage({
      type: 'quick-hint',
      selection: snapshot.selection,
    })) as QuickHintResponse;
    setBusy(false);

    if (response.status === 'failed') {
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
    setStatus('快速提示已完成。');
    placeSurface();
  }

  function closeSurface(restoreFocus: boolean): void {
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
    const status = shadow?.querySelector<HTMLElement>('[role="status"]');
    if (status !== null && status !== undefined) status.textContent = message;
  }

  function announce(message: string): void {
    setStatus(message);
  }

  function setBusy(busy: boolean): void {
    const section = shadow?.querySelector<HTMLElement>('section');
    section?.setAttribute('aria-busy', String(busy));
    const button = shadow?.querySelector<HTMLButtonElement>('.primary');
    if (button !== null && button !== undefined) button.disabled = busy;
  }

  function firstInteractiveElement(): HTMLButtonElement | null {
    return shadow?.querySelector<HTMLButtonElement>('.primary:not(:disabled)') ?? null;
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

function createStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    :host { font: 14px/1.45 system-ui, sans-serif; }
    section { box-sizing: border-box; width: 320px; max-width: calc(100vw - 16px); padding: 12px; border: 1px solid #475569; border-radius: 10px; background: #fff; color: #172033; box-shadow: 0 8px 28px rgb(15 23 42 / 24%); }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .selection-summary, .status, .error { margin: 8px 0 0; }
    button { min-height: 36px; border: 1px solid #475569; border-radius: 7px; background: #fff; color: #172033; cursor: pointer; font: inherit; }
    button:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
    button:disabled { cursor: not-allowed; opacity: .58; }
    .primary { width: 100%; margin-top: 10px; background: #1d4ed8; color: #fff; border-color: #1d4ed8; font-weight: 700; }
    .close { min-width: 48px; }
    .error { color: #991b1b; font-weight: 650; }
    .result { display: grid; gap: 4px; margin-top: 10px; padding: 10px; border-radius: 7px; background: #eff6ff; }
    @media (prefers-reduced-motion: no-preference) { section { animation: lingo-palette-in 100ms ease-out; } }
    @keyframes lingo-palette-in { from { opacity: 0; transform: translateY(3px); } }
    @media (forced-colors: active) { section, button { border: 2px solid ButtonText; } }
  `;
  return style;
}
