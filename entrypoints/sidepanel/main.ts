import { DEEP_DIVE_STATE_STORAGE_KEY } from '../../src/modules/reading-flow/deep-dive-state';
import type {
  DeepDiveResponse,
} from '../../src/modules/reading-flow/messages';
import type {
  DeepDiveCurrent,
  DeepDiveRequestState,
  DeepDiveState,
} from '../../src/modules/reading-flow/deep-dive-state';

const tabList = requiredElement<HTMLElement>('[role="tablist"]');
const tabs = Array.from(
  tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
);
const currentPanel = requiredElement<HTMLElement>('#current-panel');
const currentContent = requiredElement<HTMLElement>('#current-content');
const liveStatus = requiredElement<HTMLElement>('#live-status');

for (const tab of tabs) {
  tab.addEventListener('click', () => activateTab(tab));
}
tabList.addEventListener('keydown', (event) => {
  if (!(event.target instanceof HTMLButtonElement)) return;
  const currentIndex = tabs.indexOf(event.target);
  if (currentIndex < 0) return;
  const nextIndex = tabIndexForKey(event.key, currentIndex, tabs.length);
  if (nextIndex === null) return;
  event.preventDefault();
  const next = tabs[nextIndex];
  if (next === undefined) return;
  activateTab(next);
  next.focus();
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === 'local' &&
    changes[DEEP_DIVE_STATE_STORAGE_KEY] !== undefined
  ) {
    void loadState();
  }
});
void loadState();

async function loadState(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'get-deep-dive-state',
    })) as DeepDiveResponse;
    if (response.status !== 'loaded') {
      renderError(
        response.status === 'started'
          ? 'Deep Dive 已開始，正在等待 Current 更新。'
          : response.message,
      );
      return;
    }
    renderCurrent(response.state);
  } catch {
    renderError('無法讀取 Deep Dive Current。');
  }
}

function renderCurrent(state: DeepDiveState): void {
  const restoreFocus = currentContent.contains(document.activeElement);
  currentContent.replaceChildren();
  const heading = element('h2', 'Current');
  currentContent.append(heading);

  if (state.current === null && state.request === null) {
    currentContent.append(
      element(
        'p',
        '請在已啟用網站選取英文，再從 Lingo Palette 選取工具明確選擇 Deep Dive。',
      ),
    );
    announce('目前沒有 Deep Dive Current。');
    restoreCurrentFocus(restoreFocus);
    return;
  }

  if (state.current !== null) {
    currentContent.append(renderCompleted(state.current));
  }
  if (state.request !== null) {
    currentContent.append(renderRequest(state.request));
  }

  announce(statusAnnouncement(state));
  restoreCurrentFocus(restoreFocus);
}

function renderCompleted(current: DeepDiveCurrent): HTMLElement {
  const article = element('article');
  article.className = 'deep-dive-result';
  article.append(
    labelledText('Selection', current.selection.text, 'selection'),
    resultSection('Contextual meaning', current.result.contextualMeaning),
    resultSection('Usage fit', current.result.usageFit),
  );

  const grammar = resultSection(
    'Grammar pattern',
    current.result.grammarPattern.explanation,
  );
  grammar.insertBefore(
    element('p', current.result.grammarPattern.pattern, 'pattern'),
    grammar.lastElementChild,
  );
  article.append(grammar);

  const alternatives = element('section');
  alternatives.append(element('h3', 'Alternatives'));
  const alternativesList = element('ul');
  for (const alternative of current.result.alternatives) {
    const item = element('li');
    item.append(
      element('strong', alternative.expression),
      document.createTextNode(` — ${alternative.distinction}`),
    );
    alternativesList.append(item);
  }
  alternatives.append(alternativesList);
  article.append(alternatives);

  const examples = element('section');
  examples.append(element('h3', 'Examples'));
  const examplesList = element('ol');
  for (const example of current.result.examples) {
    const item = element('li');
    item.append(
      element('q', example.sentence),
      element('p', example.explanation),
    );
    examplesList.append(item);
  }
  examples.append(examplesList);
  article.append(examples);
  return article;
}

function renderRequest(request: DeepDiveRequestState): HTMLElement {
  const section = element('section');
  section.className = `request request-${request.status}`;
  section.setAttribute('aria-labelledby', 'request-heading');
  section.append(
    element(
      'h3',
      request.status === 'working'
        ? 'Deep Dive in progress'
        : request.status === 'cancelled'
          ? 'Deep Dive cancelled'
          : 'Deep Dive failed',
      undefined,
      'request-heading',
    ),
    labelledText('Requested Selection', request.selection.text, 'selection'),
    element('p', request.message, 'request-message'),
  );

  const actions = element('div');
  actions.className = 'actions';
  if (request.status === 'working') {
    const cancel = element('button', '取消 Deep Dive');
    cancel.addEventListener('click', () => void performAction('cancel-deep-dive'));
    actions.append(cancel);
  } else {
    const retry = element('button', '重試 Deep Dive');
    retry.addEventListener('click', () => void performAction('retry-deep-dive'));
    actions.append(retry);
  }
  section.append(actions);
  return section;
}

async function performAction(
  type: 'retry-deep-dive' | 'cancel-deep-dive',
): Promise<void> {
  announce(type === 'retry-deep-dive' ? '正在重試 Deep Dive。' : '正在取消 Deep Dive。');
  try {
    const response = (await browser.runtime.sendMessage({ type })) as DeepDiveResponse;
    if (response.status === 'loaded') {
      renderCurrent(response.state);
      return;
    }
    if (response.status === 'started') {
      announce('Deep Dive 已重新開始。');
      return;
    }
    if (response.status === 'failed' || response.status === 'cancelled') {
      renderError(response.message);
    }
  } catch {
    renderError('無法更新 Deep Dive。');
  }
}

function restoreCurrentFocus(restore: boolean): void {
  if (restore) currentPanel.focus({ preventScroll: true });
}

function renderError(message: string): void {
  const restoreFocus = currentContent.contains(document.activeElement);
  currentContent.replaceChildren(
    element('h2', 'Current'),
    element('p', message, 'error'),
  );
  announce(message);
  restoreCurrentFocus(restoreFocus);
}

function activateTab(tab: HTMLButtonElement): void {
  for (const candidate of tabs) {
    const selected = candidate === tab;
    candidate.setAttribute('aria-selected', String(selected));
    candidate.tabIndex = selected ? 0 : -1;
    const panelId = candidate.getAttribute('aria-controls');
    if (panelId !== null) {
      requiredElement<HTMLElement>(`#${panelId}`).hidden = !selected;
    }
  }
}

function tabIndexForKey(
  key: string,
  current: number,
  length: number,
): number | null {
  if (key === 'ArrowRight') return (current + 1) % length;
  if (key === 'ArrowLeft') return (current - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

function resultSection(title: string, text: string): HTMLElement {
  const section = element('section');
  section.append(element('h3', title), element('p', text));
  return section;
}

function labelledText(
  label: string,
  text: string,
  className?: string,
): HTMLElement {
  const paragraph = element('p');
  if (className !== undefined) paragraph.className = className;
  paragraph.append(element('strong', `${label}: `), document.createTextNode(text));
  return paragraph;
}

function statusAnnouncement(state: DeepDiveState): string {
  if (state.request?.status === 'working') {
    return `正在分析 ${state.request.selection.text}。`;
  }
  if (state.request !== null) return state.request.message;
  return state.current === null
    ? '目前沒有 Deep Dive Current。'
    : `Deep Dive Current 已更新為 ${state.current.selection.text}。`;
}

function announce(message: string): void {
  liveStatus.textContent = message;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
  id?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  if (id !== undefined) node.id = id;
  return node;
}

function requiredElement<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (node === null) throw new Error(`Missing Side Panel element: ${selector}`);
  return node as T;
}
