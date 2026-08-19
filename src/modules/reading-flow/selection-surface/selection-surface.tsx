import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  type VirtualElement,
} from '@floating-ui/dom';
import * as React from 'react';
import {
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useStore } from 'zustand';

import { SELECTION_LIMIT } from '../selection';
import {
  pronunciationButtonLabel,
  type ExpandedFocusTarget,
  type ReadingFlowState,
  type ReadingFlowStore,
} from '../reading-flow-store';
import {
  contrastingInkForElement,
  quietPeekPosition,
  reserveReadingLineSpace,
  selectionAnchorRect,
} from './browser-layout';
import surfaceStyles from './selection-surface.css?inline';

const expandedHostAttribute = 'data-lingo-palette-reading-flow';
const peekHostAttribute = 'data-lingo-palette-quick-hint-annotation';
const rootHostAttribute = 'data-lingo-palette-reading-flow-root';
const annotationGap = 2;
const quietPeekLineSpace = 10;
const viewportGap = 8;

export type SelectionSurfaceActions = {
  close(): void;
  enableSite(): void;
  requestQuickHint(): void;
  cancelQuickHint(): void;
  requestDeepDive(): void;
  requestPronunciation(variety: 'en-US' | 'en-GB'): void;
  togglePronunciationPause(): void;
  stopPronunciation(): void;
  expand(target: ExpandedFocusTarget): void;
  interact(): void;
};

export type SelectionSurface = {
  ownsEvent(event: Event): boolean;
  ownsElement(element: Element | null): boolean;
  destroy(): void;
};

export function createSelectionSurface(
  currentDocument: Document,
  store: ReadingFlowStore,
  actions: SelectionSurfaceActions,
): SelectionSurface {
  const host = currentDocument.createElement('div');
  host.setAttribute(rootHostAttribute, '');
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.maxWidth = 'min(320px, calc(100vw - 16px))';
  host.style.pointerEvents = 'none';
  host.style.colorScheme = 'light';
  host.hidden = true;
  const shadow = host.attachShadow({ mode: 'open' });
  const mount = currentDocument.createElement('div');
  shadow.append(mount);
  currentDocument.documentElement.append(host);
  const root = createRoot(mount);
  flushSync(() => {
    root.render(
      <>
        <style>{surfaceStyles}</style>
        <SelectionSurfaceRoot host={host} store={store} actions={actions} />
      </>,
    );
  });
  return {
    ownsEvent(event) {
      return event.composedPath().includes(host);
    },
    ownsElement(element) {
      return element === host || (element !== null && shadow.contains(element));
    },
    destroy() {
      root.unmount();
      host.remove();
    },
  };
}

type SelectionSurfaceRootProps = {
  host: HTMLElement;
  store: ReadingFlowStore;
  actions: SelectionSurfaceActions;
};

function SelectionSurfaceRoot({
  host,
  store,
  actions,
}: SelectionSurfaceRootProps) {
  const surface = useStore(store, (state) => state.surface);
  const selection = useStore(store, (state) => state.selection);

  useLayoutEffect(() => {
    const visible = surface.mode !== 'hidden' && selection !== null;
    host.hidden = !visible;
    host.toggleAttribute(expandedHostAttribute, surface.mode === 'expanded');
    host.toggleAttribute(peekHostAttribute, surface.mode === 'peek');
    if (!visible) {
      host.style.visibility = 'hidden';
      host.style.removeProperty('left');
      host.style.removeProperty('top');
    }
  }, [host, selection, surface.mode]);

  if (selection === null || surface.mode === 'hidden') return null;

  if (surface.mode === 'peek') {
    return <QuietPeek host={host} store={store} actions={actions} />;
  }

  return <ExpandedSurface host={host} store={store} actions={actions} />;
}

function QuietPeek({ host, store, actions }: SelectionSurfaceRootProps) {
  const selection = useStore(store, (state) => state.selection);
  const quickHint = useStore(store, (state) => state.quickHint);
  const statusMessage = useStore(store, (state) => state.statusMessage);
  const selectionStableAt = useStore(
    store,
    (state) => state.selectionStableAt,
  );
  const annotationRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (selection === null) return;
    return reserveReadingLineSpace(selection.range, quietPeekLineSpace);
  }, [selection]);

  useLayoutEffect(() => {
    if (selection === null) return;
    const annotation = annotationRef.current;
    const copy = copyRef.current;
    if (annotation === null || copy === null) return;
    const currentWindow = selection.range.commonAncestorContainer.ownerDocument
      ?.defaultView;
    if (currentWindow === null || currentWindow === undefined) return;

    const place = () => {
      const anchorRect = selectionAnchorRect(selection.range);
      if (anchorRect === null) return;
      const hostRect = host.getBoundingClientRect();
      const copyRect = copy.getBoundingClientRect();
      const placement = quietPeekPosition(
        anchorRect,
        hostRect,
        copyRect,
        { width: currentWindow.innerWidth, height: currentWindow.innerHeight },
        annotationGap,
        viewportGap,
      );
      host.style.left = `${placement.left}px`;
      host.style.top = `${placement.top}px`;
      host.style.visibility = 'hidden';
      const copyCenterOffset =
        copyRect.left - hostRect.left + copyRect.width / 2;
      const underlying = currentWindow.document.elementFromPoint(
        placement.left + copyCenterOffset,
        placement.top + copyRect.height / 2,
      );
      host.style.visibility = 'visible';
      if (underlying !== null) {
        annotation.dataset.ink = contrastingInkForElement(underlying);
      }
      markVisible(host, selectionStableAt);
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(annotation);
    currentWindow.addEventListener('resize', place);
    currentWindow.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      currentWindow.removeEventListener('resize', place);
      currentWindow.removeEventListener('scroll', place, true);
    };
  }, [host, quickHint, selection, selectionStableAt]);

  const presentation = quietPeekPresentation(quickHint);
  return (
    <div className="peek-host">
      <aside
        ref={annotationRef}
        className="annotation"
        aria-label="Quick Hint"
        data-pending={presentation.pending ? '' : undefined}
      >
        <span ref={copyRef} className="annotation-copy">
          <strong>{presentation.text}</strong>
        </span>
        <span className="annotation-actions">
          <PeekAction
            label="開啟發音選項"
            icon="pronunciation"
            onClick={() => actions.expand('pronunciation')}
            onInteract={actions.interact}
          />
          <PeekAction
            label="更多選取操作"
            icon="more"
            onClick={() => actions.expand('first-action')}
            onInteract={actions.interact}
          />
        </span>
      </aside>
      <p className="peek-status" role="status" aria-live="polite">
        {statusMessage}
      </p>
    </div>
  );
}

function ExpandedSurface({ host, store, actions }: SelectionSurfaceRootProps) {
  const state = useStore(store);
  const sectionRef = useRef<HTMLElement>(null);
  const lastFocusRequestRef = useRef(0);

  useLayoutEffect(() => {
    const selection = state.selection;
    const surface = state.surface;
    if (selection === null || surface.mode !== 'expanded') return;
    const currentWindow = selection.range.commonAncestorContainer.ownerDocument
      ?.defaultView;
    if (currentWindow === null || currentWindow === undefined) return;
    const virtualAnchor: VirtualElement = {
      getBoundingClientRect: () =>
        selectionAnchorRect(selection.range) ??
        selection.range.getBoundingClientRect(),
    };
    let active = true;
    host.style.visibility = 'hidden';
    const update = () => {
      void computePosition(virtualAnchor, host, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(viewportGap),
          flip({ padding: viewportGap }),
          shift({ padding: viewportGap, crossAxis: true }),
        ],
      }).then(({ x, y }) => {
        if (!active) return;
        host.style.left = `${x}px`;
        host.style.top = `${y}px`;
        host.style.visibility = 'visible';
        markVisible(host, state.selectionStableAt);
        if (
          surface.focusTarget === null ||
          lastFocusRequestRef.current === surface.focusRequest
        ) {
          return;
        }
        const section = sectionRef.current;
        const target =
          surface.focusTarget === 'pronunciation'
            ? (section?.querySelector<HTMLButtonElement>(
                '.pronunciation-variety:not(:disabled)',
              ) ?? null)
            : (section?.querySelector<HTMLButtonElement>(
                '.quick-hint:not(:disabled):not([hidden])',
              ) ??
              section?.querySelector<HTMLButtonElement>(
                '.pronunciation-variety:not(:disabled)',
              ) ??
              section?.querySelector<HTMLButtonElement>(
                '.deep-dive:not(:disabled)',
              ) ??
              section?.querySelector<HTMLButtonElement>('.close') ??
              null);
        target?.focus({ preventScroll: true });
        lastFocusRequestRef.current = surface.focusRequest;
      });
    };
    const stopAutoUpdate = autoUpdate(virtualAnchor, host, update, {
      ancestorResize: true,
      ancestorScroll: true,
      elementResize: true,
    });
    return () => {
      active = false;
      stopAutoUpdate();
    };
  }, [host, state.selection, state.selectionStableAt, state.surface]);

  if (state.selection === null || state.surface.mode !== 'expanded') return null;
  const selectionLength = state.selection.codePointLength;
  const quickHintBusy = state.quickHint.status === 'loading';

  return (
    <div className="expanded-host">
      <section
        ref={sectionRef}
        className="expanded-surface"
        role="toolbar"
        aria-label="Lingo Palette 選取工具"
        aria-busy={quickHintBusy}
        onPointerDownCapture={(event) => {
          if (event.target instanceof HTMLButtonElement) actions.interact();
        }}
      >
        <div className="header">
          <strong>Lingo Palette</strong>
          <button
            type="button"
            className="close"
            aria-label="關閉 Lingo Palette"
            onClick={actions.close}
          >
            關閉
          </button>
        </div>
        {state.siteAccess.status === 'disabled' ? (
          <PermissionSurface actions={actions} />
        ) : (
          <EnabledSurface
            state={state}
            selectionLength={selectionLength}
            actions={actions}
          />
        )}
        <p className="status" role="status" aria-live="polite">
          {state.statusMessage}
        </p>
      </section>
    </div>
  );
}

function PermissionSurface({ actions }: { actions: SelectionSurfaceActions }) {
  return (
    <>
      <p className="permission-copy">
        在 {location.hostname} 使用 Lingo Palette。只在你選取內容時提供提示與發音。
      </p>
      <button type="button" className="primary" onClick={actions.enableSite}>
        在此網站啟用 Lingo Palette
      </button>
    </>
  );
}

function EnabledSurface({
  state,
  selectionLength,
  actions,
}: {
  state: ReadingFlowState;
  selectionLength: number;
  actions: SelectionSurfaceActions;
}) {
  const quickHintBusy = state.quickHint.status === 'loading';
  const quickHintReady = state.quickHint.status === 'ready';
  const retry =
    state.quickHint.status === 'failed' ||
    state.quickHint.status === 'cancelled';
  return (
    <>
      <QuickHintResult state={state.quickHint} />
      <div className="analysis-actions">
        <button
          type="button"
          className="primary quick-hint"
          disabled={selectionLength > SELECTION_LIMIT}
          hidden={quickHintReady}
          onClick={
            quickHintBusy ? actions.cancelQuickHint : actions.requestQuickHint
          }
        >
          {quickHintBusy
            ? '取消快速提示'
            : retry
              ? '重試快速提示'
              : '快速提示'}
        </button>
        <button
          type="button"
          className="secondary deep-dive"
          aria-label="Deep Dive：在 Side Panel 深入解析"
          disabled={selectionLength > SELECTION_LIMIT}
          onClick={actions.requestDeepDive}
        >
          深入解析
        </button>
      </div>
      <PronunciationControls state={state} actions={actions} />
      {selectionLength > SELECTION_LIMIT && (
        <p className="error">
          選取內容有 {selectionLength.toLocaleString('en-US')}{' '}
          個字元，超過 Quick Hint 與 Deep Dive 的 4,000
          個字元上限；Pronunciation Playback 仍可使用，內容不會被截斷。
        </p>
      )}
    </>
  );
}

function QuickHintResult({
  state,
}: {
  state: ReadingFlowState['quickHint'];
}) {
  if (
    state.status === 'idle' ||
    state.status === 'scheduled' ||
    state.status === 'unavailable'
  ) {
    return null;
  }
  if (state.status === 'loading') {
    return (
      <div className="result" data-result="">
        <strong>正在產生更簡單的說法…</strong>
      </div>
    );
  }
  if (state.status === 'ready') {
    return (
      <div className="result" data-result="">
        <strong>{state.simplerExpression}</strong>
        {state.explanationCue !== null && <span>{state.explanationCue}</span>}
      </div>
    );
  }
  return (
    <div className="result" data-result="">
      <strong>
        {state.status === 'failed' ? '無法取得簡化版本' : '快速提示已取消'}
      </strong>
      <span>{state.message}</span>
    </div>
  );
}

function PronunciationControls({
  state,
  actions,
}: {
  state: ReadingFlowState;
  actions: SelectionSurfaceActions;
}) {
  const pronunciation = state.pronunciation;
  const active =
    pronunciation.status === 'discovering' ||
    pronunciation.status === 'generating' ||
    pronunciation.status === 'playing' ||
    pronunciation.status === 'paused';
  const revealed = pronunciation.variety !== null;
  return (
    <div
      className="pronunciation"
      role="group"
      aria-label="Pronunciation Playback"
    >
      <strong className="pronunciation-title">發音</strong>
      <div className="pronunciation-varieties">
        {(['en-US', 'en-GB'] as const).map((variety) => (
          <button
            key={variety}
            type="button"
            className={`secondary pronunciation-variety pronunciation-${variety}`}
            aria-label={variety === 'en-US' ? 'US English' : 'UK English'}
            aria-pressed={pronunciation.variety === variety && active}
            onClick={() => actions.requestPronunciation(variety)}
          >
            {pronunciationButtonLabel(variety).replace('發音', '')}
          </button>
        ))}
      </div>
      {revealed && (
        <div className="pronunciation-playback-controls">
          <button
            type="button"
            className="secondary pronunciation-pause"
            aria-disabled={!active}
            onClick={actions.togglePronunciationPause}
          >
            {pronunciation.status === 'paused' ? '繼續' : '暫停'}
          </button>
          <button
            type="button"
            className="secondary pronunciation-stop"
            aria-disabled={!active}
            onClick={actions.stopPronunciation}
          >
            停止
          </button>
        </div>
      )}
      {pronunciation.totalCharacters > 0 && (
        <progress
          className="pronunciation-progress"
          max={Math.max(1, pronunciation.totalCharacters)}
          value={pronunciation.completedCharacters}
          aria-label={`Pronunciation Playback ${pronunciation.currentChunk}/${pronunciation.totalChunks} 段`}
        />
      )}
      <p
        className="pronunciation-status"
        aria-live="polite"
        hidden={pronunciation.status === 'idle'}
      >
        {pronunciation.message}
      </p>
    </div>
  );
}

function PeekAction({
  label,
  icon,
  onClick,
  onInteract,
}: {
  label: string;
  icon: 'pronunciation' | 'more';
  onClick(): void;
  onInteract(): void;
}) {
  const preventSelectionCollapse = (event: ReactMouseEvent) => {
    event.preventDefault();
    onInteract();
  };
  return (
    <button
      type="button"
      className={`peek-action peek-${icon}`}
      aria-label={label}
      title={label}
      onPointerDown={preventSelectionCollapse}
      onClick={onClick}
    >
      <QuietPeekIcon icon={icon} />
    </button>
  );
}

function QuietPeekIcon({ icon }: { icon: 'pronunciation' | 'more' }) {
  return icon === 'pronunciation' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.8L12 6v12l-4.2-3.5H4z" />
      <path d="M15 9a4.5 4.5 0 0 1 0 6" />
      <path d="M17.5 6.5a8 8 0 0 1 0 11" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function quietPeekPresentation(state: ReadingFlowState['quickHint']): {
  text: string;
  pending: boolean;
} {
  switch (state.status) {
    case 'scheduled':
    case 'loading':
      return { text: '•••', pending: true };
    case 'ready':
      return { text: state.simplerExpression, pending: false };
    case 'failed':
      return { text: '暫時無法取得提示', pending: false };
    case 'cancelled':
      return { text: '快速提示已取消', pending: false };
    case 'unavailable':
      return { text: state.message, pending: false };
    case 'idle':
      return { text: '•••', pending: true };
  }
}

function markVisible(host: HTMLElement, selectionStableAt: number): void {
  if (selectionStableAt === 0) return;
  host.dataset.selectionStableAt = String(selectionStableAt);
  host.dataset.visibleAt = String(performance.now());
}
