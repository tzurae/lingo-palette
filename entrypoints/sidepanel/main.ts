import {
  LEARNING_STATE_STORAGE_KEY,
  type Encounter,
  type LearningItem,
  type LearningMutation,
  type LearningState,
  type MergeSuggestion,
} from '../../src/modules/learning/learning-item-store';
import type {
  LearningRequest,
  LearningResponse,
} from '../../src/modules/learning/messages';
import {
  LOOKUP_RECORDS_STORAGE_KEY,
  type LookupRecord,
} from '../../src/modules/learning/lookup-record';
import { DEEP_DIVE_STATE_STORAGE_KEY } from '../../src/modules/reading-flow/deep-dive-state';
import type {
  DeepDiveResponse,
  RecentResponse,
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
const recentPanel = requiredElement<HTMLElement>('#recent-panel');
const recentContent = requiredElement<HTMLElement>('#recent-content');
const savedPanel = requiredElement<HTMLElement>('#saved-panel');
const savedContent = requiredElement<HTMLElement>('#saved-content');
const savedError = requiredElement<HTMLElement>('#saved-error');
const liveStatus = requiredElement<HTMLElement>('#live-status');
let recentRecords: LookupRecord[] = [];
let learningState: LearningState | null = null;

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
  if (areaName !== 'local') return;
  if (changes[DEEP_DIVE_STATE_STORAGE_KEY] !== undefined) {
    void loadState();
  }
  if (changes[LOOKUP_RECORDS_STORAGE_KEY] !== undefined) {
    void loadRecent();
  }
  if (changes[LEARNING_STATE_STORAGE_KEY] !== undefined) {
    void loadSaved();
  }
});
void loadState();
void loadRecent();
void loadSaved();

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

async function loadRecent(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'get-recent',
    })) as RecentResponse;
    if (response.status !== 'loaded') {
      renderRecentError(response.message);
      return;
    }
    recentRecords = response.records;
    renderRecent(recentRecords);
  } catch {
    renderRecentError('無法讀取 Recent Lookup Records。');
  }
}

async function loadSaved(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'get-saved',
    })) as LearningResponse;
    if (response.status !== 'loaded') {
      renderSavedError(response.message);
      return;
    }
    learningState = response.state;
    renderSaved(response.state);
    renderRecent(recentRecords);
  } catch {
    renderSavedError('無法讀取 Saved Learning Items。');
  }
}

function renderRecent(records: LookupRecord[]): void {
  const restoreFocus = recentContent.contains(document.activeElement);
  recentContent.replaceChildren(element('h2', 'Recent'));
  if (records.length === 0) {
    recentContent.append(element('p', '目前沒有最近的 Lookup Records。'));
  } else {
    const list = element('ol');
    list.className = 'lookup-records';
    for (const record of records) {
      const item = element('li');
      item.append(renderLookupRecord(record));
      list.append(item);
    }
    recentContent.append(list);
  }
  if (!recentPanel.hidden) {
    announce(`Recent 已載入 ${records.length} 筆 Lookup Records。`);
  }
  if (restoreFocus) recentPanel.focus({ preventScroll: true });
}

function renderLookupRecord(record: LookupRecord): HTMLElement {
  const article = element('article');
  article.className = 'lookup-record';
  const actionLabel =
    record.action.type === 'quick-hint' ? 'Quick Hint' : 'Deep Dive';
  const completed = element(
    'time',
    new Date(record.completedAt).toLocaleString('zh-TW'),
  );
  completed.dateTime = record.completedAt;
  article.append(
    element('h3', actionLabel),
    completed,
    labelledText(
      'Usage',
      `${record.usage.source}; ${record.usage.attempts} provider attempts; ${record.usage.provider?.totalTokens ?? 0} tokens`,
    ),
  );
  if (record.sourceUrl !== undefined) {
    article.append(labelledText('Source', record.sourceUrl));
  }
  if (record.action.type === 'quick-hint') {
    article.append(
      labelledText('Selection', record.selection.text, 'selection'),
      resultSection('Simpler expression', record.action.result.simplerExpression),
    );
    if (record.action.result.explanationCue !== null) {
      article.append(
        resultSection('Explanation cue', record.action.result.explanationCue),
      );
    }
  } else {
    article.append(
      renderCompleted({
        selection: record.selection,
        result: record.action.result,
        completedAt: record.completedAt,
      }),
    );
  }
  const saved =
    learningState?.encounters.some(
      (encounter) => encounter.lookupRecordId === record.id,
    ) === true;
  const saveButton = element('button', saved ? '已儲存' : '儲存到 Saved');
  saveButton.disabled = saved;
  if (!saved) {
    saveButton.addEventListener('click', () => {
      void performLearningAction({
        type: 'save-lookup',
        lookupRecordId: record.id,
      });
    });
  }
  article.append(saveButton);
  return article;
}

function renderRecentError(message: string): void {
  const restoreFocus = recentContent.contains(document.activeElement);
  recentContent.replaceChildren(
    element('h2', 'Recent'),
    element('p', message, 'error'),
  );
  if (!recentPanel.hidden) announce(message);
  if (restoreFocus) recentPanel.focus({ preventScroll: true });
}


function renderSaved(state: LearningState): void {
  clearSavedError();
  const restoreFocus = savedContent.contains(document.activeElement);
  savedContent.replaceChildren(element('h2', 'Saved'));
  const activeItems = state.learningItems.filter(
    (item): item is Extract<LearningItem, { status: 'active' }> =>
      item.status === 'active',
  );
  if (activeItems.length === 0) {
    savedContent.append(
      element('p', '目前沒有已儲存的 Learning Items。'),
    );
  } else {
    const list = element('ol');
    list.className = 'learning-items';
    for (const item of activeItems) {
      const entry = element('li');
      entry.append(renderLearningItem(item, state, activeItems));
      list.append(entry);
    }
    savedContent.append(list);
  }

  const pendingSuggestions = state.mergeSuggestions.filter(
    (
      suggestion,
    ): suggestion is Extract<MergeSuggestion, { status: 'pending' }> =>
      suggestion.status === 'pending',
  );
  if (pendingSuggestions.length > 0) {
    const section = element('section');
    section.className = 'merge-suggestions';
    section.append(element('h2', 'Merge Suggestions'));
    for (const suggestion of pendingSuggestions) {
      section.append(renderMergeSuggestion(suggestion, state));
    }
    savedContent.append(section);
  }

  if (state.history.length > 0) {
    savedContent.append(renderLearningHistory(state.history));
  }
  if (!savedPanel.hidden) {
    announce(`Saved 已載入 ${activeItems.length} 個 Learning Items。`);
  }
  if (restoreFocus) savedPanel.focus({ preventScroll: true });
}

function renderLearningItem(
  item: Extract<LearningItem, { status: 'active' }>,
  state: LearningState,
  activeItems: Array<Extract<LearningItem, { status: 'active' }>>,
): HTMLElement {
  const article = element('article');
  article.className = 'learning-item';
  article.append(
    element('h3', item.expression),
    labelledText('Normalized expression', item.normalizedExpression),
    labelledText(
      'Sense pin',
      item.sensePin === null
        ? 'Unpinned'
        : `${item.sensePin.sourceSenseId}; ${item.sensePin.partOfSpeech}; ${item.sensePin.morphology}; pack ${item.sensePin.evidencePackVersion}`,
    ),
  );

  const intentLabel = element('label');
  intentLabel.className = 'productive-intent';
  const intent = element('input');
  intent.type = 'checkbox';
  intent.checked = item.productiveUseIntent;
  intent.addEventListener('change', () => {
    void performLearningAction({
      type: 'set-productive-use-intent',
      learningItemId: item.id,
      enabled: intent.checked,
    });
  });
  intentLabel.append(intent, document.createTextNode(' Productive-use Intent'));
  article.append(intentLabel);

  const encounters = state.encounters.filter(
    (encounter) => encounter.learningItemId === item.id,
  );
  const list = element('ol');
  list.className = 'encounters';
  for (const encounter of encounters) {
    const entry = element('li');
    entry.append(renderEncounter(encounter, item.id, activeItems));
    list.append(entry);
  }
  article.append(list);
  return article;
}

function renderEncounter(
  encounter: Encounter,
  currentLearningItemId: string,
  activeItems: Array<Extract<LearningItem, { status: 'active' }>>,
): HTMLElement {
  const section = element('section');
  section.className = 'encounter';
  section.append(
    labelledText('Context', encounterContext(encounter), 'encounter-context'),
    labelledText('Lookup Record', encounter.lookupRecordId),
    labelledText('Completed', new Date(encounter.completedAt).toLocaleString('zh-TW')),
  );
  if (encounter.sourceUrl !== undefined) {
    section.append(labelledText('Source', encounter.sourceUrl));
  }

  const targets = activeItems.filter(
    (item) => item.id !== currentLearningItemId,
  );
  if (targets.length > 0) {
    const controls = element('div');
    controls.className = 'reclassification';
    const select = element('select');
    select.setAttribute(
      'aria-label',
      `Reclassify ${encounter.selection.text} to Learning Item`,
    );
    for (const target of targets) {
      const option = element('option', target.expression);
      option.value = target.id;
      select.append(option);
    }
    const move = element('button', 'Reclassify Encounter');
    move.addEventListener('click', () => {
      void performLearningAction({
        type: 'reclassify-encounter',
        encounterId: encounter.id,
        targetLearningItemId: select.value,
      });
    });
    controls.append(select, move);
    section.append(controls);
  }
  return section;
}

function renderMergeSuggestion(
  suggestion: Extract<MergeSuggestion, { status: 'pending' }>,
  state: LearningState,
): HTMLElement {
  const article = element('article');
  article.className = 'merge-suggestion';
  article.append(
    element('h3', 'Merge Suggestion'),
    element('p', suggestion.reason),
  );
  const source = state.learningItems.find(
    (item) => item.id === suggestion.sourceLearningItemId,
  );
  const target = state.learningItems.find(
    (item) => item.id === suggestion.targetLearningItemId,
  );
  if (source !== undefined) {
    article.append(renderSuggestionContext('Separate save', source, state));
  }
  if (target !== undefined) {
    article.append(renderSuggestionContext('Existing item', target, state));
  }
  const actions = element('div');
  actions.className = 'actions';
  const merge = element('button', '合併');
  merge.addEventListener('click', () => {
    void performLearningAction({
      type: 'resolve-merge-suggestion',
      suggestionId: suggestion.id,
      decision: 'merge',
    });
  });
  const keepSeparate = element('button', '保持分開');
  keepSeparate.addEventListener('click', () => {
    void performLearningAction({
      type: 'resolve-merge-suggestion',
      suggestionId: suggestion.id,
      decision: 'keep-separate',
    });
  });
  actions.append(merge, keepSeparate);
  article.append(actions);
  return article;
}

function renderSuggestionContext(
  label: string,
  item: LearningItem,
  state: LearningState,
): HTMLElement {
  const section = element('section');
  section.className = 'suggestion-context';
  section.append(element('h4', label));
  const encounters = state.encounters.filter(
    (encounter) => encounter.learningItemId === item.id,
  );
  for (const encounter of encounters) {
    section.append(
      labelledText('Context', encounterContext(encounter)),
      labelledText('Lookup Record', encounter.lookupRecordId),
    );
    if (encounter.sourceUrl !== undefined) {
      section.append(labelledText('Source', encounter.sourceUrl));
    }
  }
  return section;
}

function renderLearningHistory(history: LearningMutation[]): HTMLElement {
  const section = element('section');
  section.className = 'learning-history';
  section.append(element('h2', 'Learning history'));
  let latestActiveMutationId: string | null = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index];
    if (candidate?.undoneAt === null) {
      latestActiveMutationId = candidate.id;
      break;
    }
  }
  const list = element('ol');
  for (const mutation of history.toReversed()) {
    const entry = element('li');
    entry.className = 'learning-mutation';
    entry.append(
      element('strong', learningMutationLabel(mutation)),
      labelledText('Mutation ID', mutation.id),
      element(
        'p',
        mutation.undoneAt === null
          ? mutation.type === 'keep-separate'
            ? '已選擇保持分開'
            : '目前生效'
          : `已復原：${new Date(mutation.undoneAt).toLocaleString('zh-TW')}`,
      ),
    );
    if (mutation.id === latestActiveMutationId) {
      const undo = element('button', '復原');
      undo.addEventListener('click', () => {
        void performLearningAction({
          type: 'undo-learning-mutation',
          mutationId: mutation.id,
        });
      });
      entry.append(undo);
    }
    list.append(entry);
  }
  section.append(list);
  return section;
}

function learningMutationLabel(mutation: LearningMutation): string {
  if (mutation.type === 'auto-merge') return '自動合併';
  if (mutation.type === 'learner-merge') return 'Learner 合併';
  if (mutation.type === 'keep-separate') return '保持分開';
  return 'Encounter reclassification';
}

function encounterContext(encounter: Encounter): string {
  return `${encounter.selection.context.before}${encounter.selection.text}${encounter.selection.context.after}`;
}

async function performLearningAction(request: LearningRequest): Promise<void> {
  clearSavedError();
  announce('正在更新 Saved。');
  try {
    const response = (await browser.runtime.sendMessage(
      request,
    )) as LearningResponse;
    if (response.status !== 'loaded') {
      renderSavedError(response.message);
      return;
    }
    learningState = response.state;
    renderSaved(response.state);
    renderRecent(recentRecords);
  } catch {
    renderSavedError('無法更新 Saved Learning Items。');
  }
}

function renderSavedError(message: string): void {
  savedError.textContent = message;
  savedError.hidden = false;
  if (!savedPanel.hidden) announce(message);
}

function clearSavedError(): void {
  savedError.textContent = '';
  savedError.hidden = true;
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
