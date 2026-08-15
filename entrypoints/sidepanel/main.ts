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
import type {
  ReviewRequest,
  ReviewResponse,
  ReviewSessionSnapshot,
} from '../../src/modules/review/messages';
import type {
  RetrievalFluency,
  ReviewJudgment,
} from '../../src/modules/review/review-evidence';
import type {
  MeasuredReviewKnowledgeDimension,
} from '../../src/modules/review/review-source-authority';
import {
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_EVIDENCE_STORAGE_KEY,
  REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
  REVIEW_SCHEDULES_STORAGE_KEY,
  REVIEW_SESSIONS_STORAGE_KEY,
} from '../../src/modules/review/review-storage-keys';
import type { ReviewSessionView } from '../../src/modules/review/review-session-store';
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
const reviewPanel = requiredElement<HTMLElement>('#review-panel');
const reviewContent = requiredElement<HTMLElement>('#review-content');
const reviewError = requiredElement<HTMLElement>('#review-error');
const liveStatus = requiredElement<HTMLElement>('#live-status');
let recentRecords: LookupRecord[] = [];
let learningState: LearningState | null = null;
let reviewActionInProgress = false;

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
  const learningStateChanged =
    changes[LEARNING_STATE_STORAGE_KEY] !== undefined;
  if (learningStateChanged) {
    void loadSaved();
  }
  if (
    learningStateChanged ||
    changes[APPROVED_REVIEW_ITEMS_STORAGE_KEY] !== undefined ||
    changes[REVIEW_EVIDENCE_STORAGE_KEY] !== undefined ||
    changes[REVIEW_REVALIDATION_MARKERS_STORAGE_KEY] !== undefined ||
    changes[REVIEW_SCHEDULES_STORAGE_KEY] !== undefined ||
    changes[REVIEW_SESSIONS_STORAGE_KEY] !== undefined
  ) {
    if (!reviewActionInProgress) void loadReview();
  }
});
void loadState();
void loadRecent();
void loadSaved();
void loadReview();

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

async function loadReview(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'get-review-session',
    } satisfies ReviewRequest)) as ReviewResponse;
    if (response.status !== 'loaded') {
      renderReviewError(
        response.status === 'failed'
          ? response.message
          : '無法讀取 Review Session。',
      );
      return;
    }
    renderReviewSnapshot(response.snapshot);
  } catch {
    renderReviewError('無法讀取 Review Session。');
  }
}

function renderReviewSnapshot(
  snapshot: ReviewSessionSnapshot,
  forceRestoreFocus = false,
): void {
  const restoreFocus =
    forceRestoreFocus || reviewContent.contains(document.activeElement);
  clearReviewError();
  if (snapshot.activeSession !== null) {
    renderReviewSession(snapshot.activeSession, restoreFocus);
    return;
  }
  reviewContent.replaceChildren(element('h2', 'Review'));
  const summary = element('section');
  summary.className = 'review-summary';
  summary.append(
    element('h3', '到期 Review Items'),
    element(
      'p',
      snapshot.eligibleCount === 0
        ? '目前沒有到期且可用的 Review Item。'
        : `目前有 ${snapshot.eligibleCount} 個 Learning Items 可以複習。`,
    ),
  );
  const start = element(
    'button',
    snapshot.eligibleCount === 0 ? '沒有可開始的 Review' : '開始 Review',
  );
  start.disabled = snapshot.eligibleCount === 0;
  start.addEventListener('click', () =>
    void performReviewRequest({ type: 'start-review-session' }),
  );
  summary.append(start);
  reviewContent.append(
    summary,
    renderReviewPreparation(snapshot),
    renderReviewSchedules(snapshot),
    renderReviewEvidence(snapshot),
  );
  if (!reviewPanel.hidden) {
    announce(
      snapshot.eligibleCount === 0
        ? '目前沒有到期的 Review Items。'
        : `可以開始 ${Math.min(snapshot.eligibleCount, 5)} 題 Review。`,
    );
  }
  restoreReviewFocus(restoreFocus);
}

function renderReviewPreparation(
  snapshot: ReviewSessionSnapshot,
): HTMLElement {
  const details = element('details');
  details.className = 'review-schedules';
  details.append(
    element(
      'summary',
      `背景準備（${snapshot.preparation.jobs.length}）`,
    ),
  );
  if (snapshot.preparation.jobs.length === 0) {
    details.append(
      element('p', '目前沒有等待中或暫停的 Review 準備工作。'),
    );
    return details;
  }
  const list = element('ul');
  for (const job of snapshot.preparation.jobs) {
    const item = element('li');
    item.className = 'review-schedule';
    item.append(
      labelledText(
        'Learning Item',
        job.context.learningItem.expression,
      ),
      labelledText('Knowledge Dimension', job.knowledgeDimension),
      labelledText('狀態', reviewPreparationStatus(job)),
      labelledText('嘗試次數', `${job.attempts} / 3`),
    );
    if (job.status === 'paused') {
      const resume = element('button', '重試背景準備');
      resume.addEventListener('click', () =>
        void performReviewRequest({
          type: 'resume-review-preparation',
          jobId: job.id,
        }),
      );
      item.append(resume);
    }
    list.append(item);
  }
  details.append(list);
  return details;
}

function reviewPreparationStatus(
  job: ReviewSessionSnapshot['preparation']['jobs'][number],
): string {
  if (job.status === 'queued') return '等待背景執行';
  if (job.status === 'running') return '執行中；中斷後會安全復原';
  switch (job.pauseReason) {
    case 'offline':
      return '已暫停：離線';
    case 'provider-disabled':
      return '已暫停：OpenAI provider 未啟用';
    case 'background-token-budget':
      return '已暫停：背景 token 額度已滿';
    case 'background-estimated-cost-budget':
      return '已暫停：背景預估成本額度已滿';
    case 'retry-exhausted':
      return `已暫停：重試用盡（${job.lastFailureKind ?? '未知錯誤'}）`;
    case 'activation-failed':
      return '已暫停：核准結果無法寫入';
    default:
      return `已暫停：${job.lastFailureKind ?? '不可重試錯誤'}`;
  }
}

function renderReviewSchedules(snapshot: ReviewSessionSnapshot): HTMLElement {
  const details = element('details');
  details.className = 'review-schedules';
  details.append(
    element('summary', `排程狀態（${snapshot.schedules.length}）`),
  );
  if (snapshot.schedules.length === 0) {
    details.append(element('p', '尚未建立任何知識面向排程。'));
    return details;
  }
  const list = element('ol');
  for (const schedule of snapshot.schedules) {
    const item = element('li');
    const card = element('article');
    card.className = 'review-schedule';
    card.append(
      element('strong', schedule.knowledgeDimension),
      labelledText('Learning Item ID', schedule.learningItemId),
      labelledText('Interval stage', String(schedule.intervalStage)),
      labelledText('Demonstrated count', String(schedule.demonstratedCount)),
      labelledText(
        'Due',
        new Date(schedule.dueAt).toLocaleString('zh-TW'),
      ),
    );
    item.append(card);
    list.append(item);
  }
  details.append(list);
  return details;
}

function renderReviewEvidence(snapshot: ReviewSessionSnapshot): HTMLElement {
  const details = element('details');
  details.className = 'review-evidence';
  details.append(element('summary', `Review Evidence（${snapshot.evidence.length}）`));
  if (snapshot.evidence.length === 0) {
    details.append(element('p', '尚未記錄任何 Review Evidence。'));
    return details;
  }
  const list = element('ol');
  for (let index = snapshot.evidence.length - 1; index >= 0; index -= 1) {
    const evidence = snapshot.evidence[index]!;
    const item = element('li');
    const record = element('article');
    record.className = 'review-evidence-record';
    record.append(
      element(
        'strong',
        evidence.kind === 'objective' ? '客觀 Review Evidence' : '自我評估 Review Evidence',
      ),
      labelledText(
        'Knowledge dimension',
        reviewKnowledgeDimensionLabel(evidence.knowledgeDimension),
      ),
      labelledText(
        'Retrieval Fluency',
        retrievalFluencyLabel(evidence.retrievalFluency),
      ),
      labelledText(
        'Recorded',
        new Date(evidence.recordedAt).toLocaleString('zh-TW'),
      ),
    );
    if (evidence.kind === 'objective') {
      record.append(
        labelledText('Overt response', evidence.responseText),
        labelledText('Review Judgment', reviewJudgmentLabel(evidence.judgment)),
      );
    }
    if (evidence.sourceAuthority !== undefined) {
      record.append(
        labelledText(
          'Source authority',
          evidence.sourceAuthority.evidence
            .map(
              (entry) =>
                `${entry.sourceId} ${entry.sourceVersion} · ${entry.authority} · ${entry.evidenceId}`,
            )
            .join('；'),
        ),
      );
    }
    record.append(
      labelledText(
        'Schedule transition',
        `stage ${evidence.scheduleTransition.previous.intervalStage} → ${evidence.scheduleTransition.next.intervalStage}`,
      ),
      labelledText(
        'Demonstrated count',
        `${evidence.scheduleTransition.previous.demonstratedCount} → ${evidence.scheduleTransition.next.demonstratedCount}`,
      ),
      labelledText(
        'Previous due',
        new Date(
          evidence.scheduleTransition.previous.dueAt,
        ).toLocaleString('zh-TW'),
      ),
      labelledText(
        'Next due',
        new Date(evidence.scheduleTransition.next.dueAt).toLocaleString('zh-TW'),
      ),
    );
    item.append(record);
    list.append(item);
  }
  details.append(list);
  return details;
}

function renderReviewSession(
  session: ReviewSessionView,
  forceRestoreFocus = false,
): void {
  const restoreFocus =
    forceRestoreFocus || reviewContent.contains(document.activeElement);
  clearReviewError();
  reviewContent.replaceChildren(element('h2', 'Review Session'));
  const card = element('article');
  card.className = 'review-card';
  card.append(
    element('p', `第 ${session.position} / ${session.total} 題`),
  );
  if (session.shortened) {
    card.append(
      element(
        'p',
        `這是 ${session.total} 題的 shortened session；不會提前拉入尚未到期的項目。`,
      ),
    );
  }
  const current = session.current;
  if (current === null) {
    card.append(element('p', 'Review Session 已完成。'));
    reviewContent.append(card);
    restoreReviewFocus(restoreFocus);
    return;
  }
  card.append(
    labelledText(
      'Knowledge dimension',
      reviewKnowledgeDimensionLabel(current.knowledgeDimension),
    ),
    labelledText(
      'Review mode',
      current.knowledgeDimension === 'productive-use'
        ? '主動產出（客觀評分）'
        : current.attemptKind === 'objective'
          ? '客觀校準'
          : '自我評估',
    ),
    element('h3', current.prompt),
    element('p', current.contextQuote, 'context-quote'),
  );
  const actions = element('div');
  actions.className = 'actions';
  if (!current.revealed) {
    card.append(
      element(
        'p',
        current.knowledgeDimension === 'productive-use'
          ? '請輸入完整產出；Retrieval Fluency 只記錄主觀感受，Review Judgment 仍以輸入內容客觀評分。'
          : current.attemptKind === 'objective'
            ? '請先回想、輸入你的答案，再選擇最符合剛才回想狀態的 Retrieval Fluency。'
            : '請先在心中回想，再選擇最符合剛才回想狀態的 Retrieval Fluency。',
      ),
    );
    let responseInput: HTMLTextAreaElement | null = null;
    if (current.attemptKind === 'objective') {
      const responseLabel = element('label', '你的答案');
      responseLabel.htmlFor = 'review-response';
      responseInput = document.createElement('textarea');
      responseInput.id = 'review-response';
      responseInput.name = 'review-response';
      responseInput.rows = 3;
      responseInput.maxLength = 4_000;
      responseInput.required = true;
      card.append(responseLabel, responseInput);
    }
    const fluencyHeading = element('h3', 'Retrieval Fluency');
    const fluencyActions = element('div');
    fluencyActions.className = 'actions review-fluency-actions';
    const choices = [
      ['did-not-recall', '沒有想起來'],
      ['recalled-with-effort', '想起來但有點費力'],
      ['recalled-fluently', '很流暢地想起來'],
    ] as const;
    for (const [retrievalFluency, label] of choices) {
      const choice = element('button', label);
      choice.addEventListener('click', () => {
        const responseText = responseInput?.value.trim();
        if (responseInput !== null && !responseText) {
          announce('客觀校準需要先輸入答案。');
          responseInput.focus();
          return;
        }
        void performReviewRequest({
          type: 'answer-review-item',
          sessionId: session.id,
          retrievalFluency,
          ...(responseText === undefined ? {} : { responseText }),
        });
      });
      fluencyActions.append(choice);
    }
    card.append(fluencyHeading, fluencyActions);
  } else {
    const answer = element('section');
    answer.className = 'review-answer';
    answer.append(
      labelledText(
        'Retrieval Fluency',
        retrievalFluencyLabel(current.evidence.retrievalFluency),
      ),
    );
    if (current.evidence.kind === 'objective') {
      answer.append(
        labelledText(
          'Review Judgment',
          reviewJudgmentLabel(current.evidence.judgment),
        ),
      );
    }
    answer.append(element('h3', '目標答案'));
    const targets = element('ul');
    for (const value of current.targetAnswers) {
      targets.append(element('li', value));
    }
    answer.append(targets);
    if (current.acceptableAlternativeAnswers.length > 0) {
      answer.append(element('h3', '可接受的替代答案'));
      const alternatives = element('ul');
      for (const value of current.acceptableAlternativeAnswers) {
        alternatives.append(element('li', value));
      }
      answer.append(alternatives);
    }
    if (current.partialAnswers.length > 0) {
      answer.append(element('h3', '部分答案'));
      const partials = element('ul');
      for (const value of current.partialAnswers) {
        partials.append(element('li', value));
      }
      answer.append(partials);
    }
    if (current.distractors.length > 0) {
      answer.append(element('h3', '需避開的答案'));
      const distractors = element('ul');
      for (const value of current.distractors) {
        distractors.append(element('li', value));
      }
      answer.append(distractors);
    }
    answer.append(labelledText('說明', current.correctiveExplanation));
    card.append(answer);
    const advance = element(
      'button',
      session.position === session.total ? '完成 Review' : '下一題',
    );
    advance.addEventListener('click', () =>
      void performReviewRequest({
        type: 'advance-review-session',
        sessionId: session.id,
      }),
    );
    actions.append(advance);
  }
  card.append(actions);
  reviewContent.append(card);
  if (!reviewPanel.hidden) {
    announce(
      current.revealed
        ? `第 ${session.position} 題結果已顯示。`
        : `第 ${session.position} 題，請先回想再記錄 Retrieval Fluency。`,
    );
  }
  restoreReviewFocus(restoreFocus);
}

async function performReviewRequest(request: ReviewRequest): Promise<void> {
  const restoreFocus = reviewContent.contains(document.activeElement);
  reviewActionInProgress = true;
  setReviewBusy(true);
  try {
    const response = (await browser.runtime.sendMessage(
      request,
    )) as ReviewResponse;
    if (response.status === 'failed') {
      renderReviewError(response.message);
      restoreReviewFocus(restoreFocus);
      return;
    }
    if (response.status === 'unavailable') {
      await loadReview();
      restoreReviewFocus(restoreFocus);
      return;
    }
    if (
      response.status === 'started' ||
      response.status === 'active' ||
      response.status === 'revealed'
    ) {
      renderReviewSession(response.session, restoreFocus);
      return;
    }
    if (response.status === 'completed') {
      renderReviewCompleted(response.session, restoreFocus);
      return;
    }
    if (response.status === 'loaded') {
      renderReviewSnapshot(response.snapshot, restoreFocus);
      return;
    }
    restoreReviewFocus(restoreFocus);
  } catch {
    renderReviewError('無法更新 Review Session。');
    restoreReviewFocus(restoreFocus);
  } finally {
    reviewActionInProgress = false;
  }
}

function renderReviewCompleted(
  session: ReviewSessionView,
  forceRestoreFocus = false,
): void {
  const restoreFocus =
    forceRestoreFocus || reviewContent.contains(document.activeElement);
  clearReviewError();
  reviewContent.replaceChildren(element('h2', 'Review Session'));
  const summary = element('section');
  summary.className = 'review-summary';
  summary.append(
    element('h3', '本次 Review 已完成'),
    element(
      'p',
      `已完成 ${session.total} 題${session.shortened ? ' shortened session' : ''}。`,
    ),
  );
  const back = element('button', '返回 Review');
  back.addEventListener('click', () => void loadReview());
  summary.append(back);
  reviewContent.append(summary);
  announce(`Review Session 已完成，共 ${session.total} 題。`);
  restoreReviewFocus(restoreFocus);
}

function renderReviewError(message: string): void {
  reviewError.textContent = message;
  reviewError.hidden = false;
  setReviewBusy(false);
  announce(message);
}

function clearReviewError(): void {
  reviewError.textContent = '';
  reviewError.hidden = true;
}

function setReviewBusy(busy: boolean): void {
  for (const button of reviewContent.querySelectorAll('button')) {
    button.disabled = busy;
  }
}

function restoreReviewFocus(restore: boolean): void {
  if (!restore) return;
  const nextAction = reviewContent.querySelector<
    HTMLTextAreaElement | HTMLButtonElement
  >('textarea:not(:disabled), button:not(:disabled)');
  if (nextAction !== null) {
    nextAction.focus({ preventScroll: true });
    return;
  }
  reviewPanel.focus({ preventScroll: true });
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
    savedContent.append(renderLearningHistory(state));
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

function renderLearningHistory(state: LearningState): HTMLElement {
  const history = state.history;
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
    if (
      mutation.type === 'auto-merge' ||
      mutation.type === 'learner-merge'
    ) {
      entry.append(renderMergeMutationDetails(mutation, state));
    }
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

function renderMergeMutationDetails(
  mutation: Extract<
    LearningMutation,
    { type: 'auto-merge' | 'learner-merge' }
  >,
  state: LearningState,
): HTMLElement {
  const details = element('section');
  details.className = 'mutation-details';
  details.append(element('h3', 'Merge participants'));
  const source = state.learningItems.find(
    (item) => item.id === mutation.sourceLearningItemId,
  );
  const target = state.learningItems.find(
    (item) => item.id === mutation.targetLearningItemId,
  );
  details.append(
    labelledText(
      'Source Learning Item',
      source === undefined
        ? mutation.sourceLearningItemId
        : `${source.expression} (${source.id})`,
    ),
    labelledText(
      'Target Learning Item',
      target === undefined
        ? mutation.targetLearningItemId
        : `${target.expression} (${target.id})`,
    ),
  );
  for (const encounterId of [
    ...mutation.targetEncounterIds,
    ...mutation.encounterIds,
  ]) {
    const encounter = state.encounters.find(
      (candidate) => candidate.id === encounterId,
    );
    const encounterDetails = element('section');
    encounterDetails.className = 'mutation-encounter';
    encounterDetails.append(element('h4', `Encounter ${encounterId}`));
    if (encounter !== undefined) {
      encounterDetails.append(
        labelledText('Context', encounterContext(encounter)),
        labelledText('Lookup Record', encounter.lookupRecordId),
      );
      if (encounter.sourceUrl !== undefined) {
        encounterDetails.append(labelledText('Source', encounter.sourceUrl));
      }
    }
    details.append(encounterDetails);
  }
  return details;
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

function reviewKnowledgeDimensionLabel(
  value: MeasuredReviewKnowledgeDimension,
): string {
  if (value === 'contextual-meaning') return '語境意義';
  if (value === 'usage-fit') return '語境用法適切性';
  if (value === 'grammar-pattern') return '文法模式';
  if (value === 'collocation') return '搭配詞';
  return '主動產出';
}

function retrievalFluencyLabel(value: RetrievalFluency): string {
  if (value === 'did-not-recall') return '沒有想起來';
  if (value === 'recalled-with-effort') return '想起來但有點費力';
  return '很流暢地想起來';
}

function reviewJudgmentLabel(value: ReviewJudgment): string {
  if (value === 'demonstrated') return '已展現';
  if (value === 'acceptable-alternative') return '可接受的替代答案';
  if (value === 'partial') return '部分展現';
  if (value === 'not-demonstrated') return '未展現';
  return '無法評分';
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
