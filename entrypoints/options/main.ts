import {
  BUNDLED_EVIDENCE_PACK_VERSION,
  SUPPORTED_EVIDENCE_PACK_RELEASES,
} from '../../src/modules/evidence/evidence-pack-catalog';
import {
  parseEvidencePackResponse,
  type EvidencePackRequest,
  type EvidencePackResponse,
  type EvidencePackStatusSnapshot,
} from '../../src/modules/evidence/messages';
import { validateDailyBudget } from '../../src/modules/openai/budget-ledger';
import {
  CURATED_REASONING_EFFORTS,
  CUSTOM_REASONING_EFFORTS,
  CURATED_OPENAI_MODELS,
  DEFAULT_OPENAI_CONFIGURATION,
  PERSONAL_INSTRUCTIONS_LIMIT,
  validateOpenAiConfiguration,
  type OpenAiConfiguration,
  type ReasoningEffort,
} from '../../src/modules/openai/configuration-store';
import {
  parseOpenAiSettingsResponse,
  type OpenAiSettingsRequest,
  type OpenAiSettingsResponse,
  type OpenAiSettingsSnapshot,
} from '../../src/modules/openai/messages';
import { codePointLength } from '../../src/modules/reading-flow/selection';
import { revokeEnabledSite } from '../../src/modules/reading-flow/site-access';
import {
  isEnabledSiteScriptId,
  originFromMatchPattern,
} from '../../src/modules/reading-flow/site-permission';
import './style.css';

const openAiForm = requiredElement<HTMLFormElement>('openai-form');
const openAiApiKey =
  requiredElement<HTMLInputElement>('openai-api-key');
const showOpenAiApiKey =
  requiredElement<HTMLInputElement>('show-openai-api-key');
const removeOpenAiApiKey = requiredElement<HTMLButtonElement>(
  'remove-openai-api-key',
);
const openAiModel = requiredElement<HTMLSelectElement>('openai-model');
const customModelField =
  requiredElement<HTMLDivElement>('custom-model-field');
const customOpenAiModel =
  requiredElement<HTMLInputElement>('custom-openai-model');
const quickHintEffort =
  requiredElement<HTMLSelectElement>('quick-hint-effort');
const deepDiveEffort =
  requiredElement<HTMLSelectElement>('deep-dive-effort');
const reviewEffort = requiredElement<HTMLSelectElement>('review-effort');
const personalInstructions =
  requiredElement<HTMLTextAreaElement>('personal-instructions');
const personalInstructionsLimit = requiredElement<HTMLSpanElement>(
  'personal-instructions-limit',
);
const personalInstructionsCount = requiredElement<HTMLParagraphElement>(
  'personal-instructions-count',
);
const activateOpenAi =
  requiredElement<HTMLButtonElement>('activate-openai');
const activeOpenAiConfiguration = requiredElement<HTMLParagraphElement>(
  'active-openai-configuration',
);
const openAiProbeUsage =
  requiredElement<HTMLUListElement>('openai-probe-usage');
const openAiStatus = requiredElement<HTMLParagraphElement>('openai-status');
const dailyTokenLimit =
  requiredElement<HTMLInputElement>('daily-token-limit');
const dailyCostLimit =
  requiredElement<HTMLInputElement>('daily-cost-limit');
const saveDailyBudget =
  requiredElement<HTMLButtonElement>('save-daily-budget');
const budgetUsage = requiredElement<HTMLParagraphElement>('budget-usage');
const pricingStatus = requiredElement<HTMLParagraphElement>('pricing-status');
const openAiUsageDashboard =
  requiredElement<HTMLAnchorElement>('openai-usage-dashboard');
const budgetStatus = requiredElement<HTMLParagraphElement>('budget-status');
const enabledSites = requiredElement<HTMLUListElement>('enabled-sites');
const sitesStatus = requiredElement<HTMLParagraphElement>('sites-status');
const commandBinding = requiredElement<HTMLParagraphElement>('command-binding');
const activeEvidencePack =
  requiredElement<HTMLElement>('active-evidence-pack');
const rollbackEvidencePack =
  requiredElement<HTMLElement>('rollback-evidence-pack');
const inspectEvidencePack = requiredElement<HTMLButtonElement>(
  'inspect-evidence-pack',
);
const rollbackEvidencePackButton = requiredElement<HTMLButtonElement>(
  'rollback-evidence-pack-button',
);
const evidencePackDisclosure = requiredElement<HTMLDivElement>(
  'evidence-pack-disclosure',
);
const evidencePackSizeDisclosure = requiredElement<HTMLParagraphElement>(
  'evidence-pack-size-disclosure',
);
const evidencePackAttributions = requiredElement<HTMLUListElement>(
  'evidence-pack-attributions',
);
const confirmEvidencePack = requiredElement<HTMLButtonElement>(
  'confirm-evidence-pack',
);
const evidencePackStatus = requiredElement<HTMLParagraphElement>(
  'evidence-pack-status',
);
let stagedEvidencePackCandidateId: string | null = null;
let evidencePackRollbackAvailable = false;
let hasStoredOpenAiApiKey = false;

openAiForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void activateOpenAiConfiguration();
});
showOpenAiApiKey.addEventListener('change', () => {
  openAiApiKey.type = showOpenAiApiKey.checked ? 'text' : 'password';
});
removeOpenAiApiKey.addEventListener('click', () => {
  void removeStoredOpenAiApiKey();
});
saveDailyBudget.addEventListener('click', () => {
  void updateDailyBudget();
});
openAiModel.addEventListener('change', () => {
  renderModelControls({
    quickHint: reasoningEffortFromField(quickHintEffort),
    deepDive: reasoningEffortFromField(deepDiveEffort),
    review: reasoningEffortFromField(reviewEffort),
  });
});
personalInstructions.addEventListener('input', renderInstructionCount);
inspectEvidencePack.addEventListener('click', () => {
  void inspectSupportedEvidencePack();
});
confirmEvidencePack.addEventListener('click', () => {
  void activateInspectedEvidencePack();
});
rollbackEvidencePackButton.addEventListener('click', () => {
  void rollbackActiveEvidencePack();
});
renderModelOptions();
renderInstructionCount();

void renderOpenAiSettings();
void renderEnabledSites();
void renderCommandBinding();
void renderEvidencePackStatus();

function renderModelOptions(): void {
  const descriptions = ['預設', '較低成本'] as const;
  const options = CURATED_OPENAI_MODELS.map((model, index) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = `${model}（${descriptions[index]}）`;
    return option;
  });
  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = 'Custom OpenAI model';
  openAiModel.replaceChildren(...options, customOption);
  personalInstructionsLimit.textContent =
    PERSONAL_INSTRUCTIONS_LIMIT.toLocaleString('en-US');
}

async function renderOpenAiSettings(): Promise<void> {
  try {
    const response = await sendOpenAiSettingsMessage({
      type: 'get-openai-settings',
    });
    if (response.status === 'failed') {
      openAiStatus.textContent = response.message;
      return;
    }
    applyOpenAiSettings(response.settings);
  } catch {
    openAiStatus.textContent = '無法讀取 OpenAI 設定。';
  }
}

async function activateOpenAiConfiguration(): Promise<void> {
  openAiStatus.textContent = '';
  openAiProbeUsage.replaceChildren();
  let configuration: OpenAiConfiguration;
  try {
    configuration = configurationFromForm();
  } catch (error) {
    openAiStatus.textContent =
      error instanceof Error ? error.message : 'OpenAI 設定無效。';
    return;
  }

  setOpenAiBusy(true);
  try {
    const response = await sendOpenAiSettingsMessage({
      type: 'activate-openai-configuration',
      configuration,
      ...(openAiApiKey.value.length === 0
        ? {}
        : { apiKey: openAiApiKey.value }),
    });
    if (response.status === 'failed') {
      renderProbeUsage(response.probes ?? []);
      openAiStatus.textContent = response.message;
      return;
    }
    if (response.status !== 'activated') {
      openAiStatus.textContent = 'OpenAI 設定回應不完整。';
      return;
    }
    applyOpenAiSettings(response.settings);
    renderProbeUsage(response.probes);
    openAiStatus.textContent =
      response.probes.length === 0
        ? `已啟用 ${response.settings.configuration.model.id}。`
        : `全部 ${response.probes.length} 個 capability probes 通過，已原子啟用 ${response.settings.configuration.model.id}。`;
  } catch {
    openAiStatus.textContent = '無法連線到 Lingo Palette background。';
  } finally {
    setOpenAiBusy(false);
  }
}

async function removeStoredOpenAiApiKey(): Promise<void> {
  setOpenAiBusy(true);
  try {
    const response = await sendOpenAiSettingsMessage({
      type: 'remove-openai-api-key',
    });
    if (response.status === 'failed') {
      openAiStatus.textContent = response.message;
      return;
    }
    if (response.status !== 'key-removed') {
      openAiStatus.textContent = '移除 API key 的回應不完整。';
      return;
    }
    applyOpenAiSettings(response.settings);
    openAiStatus.textContent = '已從此裝置移除 OpenAI API key。';
  } catch {
    openAiStatus.textContent = '無法移除 OpenAI API key。';
  } finally {
    setOpenAiBusy(false);
  }
}
async function updateDailyBudget(): Promise<void> {
  budgetStatus.textContent = '';
  let budget;
  if (dailyTokenLimit.value.trim() === '' || dailyCostLimit.value.trim() === '') {
    budgetStatus.textContent = '每日 hard limits 不可空白；輸入 0 才會停用 provider Actions。';
    return;
  }
  try {
    budget = validateDailyBudget({
      tokenLimit: Number(dailyTokenLimit.value),
      estimatedCostUsdLimit: Number(dailyCostLimit.value),
    });
  } catch (error) {
    budgetStatus.textContent =
      error instanceof Error ? error.message : '每日 hard limits 無效。';
    return;
  }

  setOpenAiBusy(true);
  try {
    const response = await sendOpenAiSettingsMessage({
      type: 'update-openai-budget',
      budget,
    });
    if (response.status === 'failed') {
      budgetStatus.textContent = response.message;
      return;
    }
    if (response.status !== 'budget-updated') {
      budgetStatus.textContent = '每日 hard limits 回應不完整。';
      return;
    }
    applyOpenAiSettings(response.settings);
    budgetStatus.textContent = '每日 provider hard limits 已儲存。';
  } catch {
    budgetStatus.textContent = '無法更新每日 provider hard limits。';
  } finally {
    setOpenAiBusy(false);
  }
}


function configurationFromForm(): OpenAiConfiguration {
  const model =
    openAiModel.value === 'custom'
      ? { kind: 'custom' as const, id: customOpenAiModel.value }
      : { kind: 'curated' as const, id: openAiModel.value };
  return validateOpenAiConfiguration({
    model,
    efforts: {
      quickHint: quickHintEffort.value,
      deepDive: deepDiveEffort.value,
      review: reviewEffort.value,
    },
    personalInstructions: personalInstructions.value,
  });
}

function applyOpenAiSettings(settings: OpenAiSettingsSnapshot): void {
  const { configuration } = settings;
  hasStoredOpenAiApiKey = settings.hasApiKey;
  openAiModel.value =
    configuration.model.kind === 'custom'
      ? 'custom'
      : configuration.model.id;
  customOpenAiModel.value =
    configuration.model.kind === 'custom' ? configuration.model.id : '';
  renderModelControls(configuration.efforts);
  personalInstructions.value = configuration.personalInstructions;
  renderInstructionCount();
  openAiApiKey.value = '';
  openAiApiKey.type = 'password';
  showOpenAiApiKey.checked = false;
  openAiApiKey.placeholder = settings.hasApiKey
    ? '已在此裝置儲存'
    : '尚未儲存';
  removeOpenAiApiKey.disabled = !settings.hasApiKey;
  activeOpenAiConfiguration.textContent =
    `目前設定：${configuration.model.id}；Quick Hint ${configuration.efforts.quickHint}、Deep Dive ${configuration.efforts.deepDive}、Review ${configuration.efforts.review}。`;
  renderBudgetSettings(settings);
}

function renderBudgetSettings(settings: OpenAiSettingsSnapshot): void {
  const { budget, pricing } = settings;
  dailyTokenLimit.value = String(budget.settings.tokenLimit);
  dailyCostLimit.value = String(budget.settings.estimatedCostUsdLimit);
  const usedCost =
    budget.used.estimatedCostUsd === null
      ? '無本機估算'
      : `US$${budget.used.estimatedCostUsd.toFixed(6)}`;
  budgetUsage.textContent =
    `本機日期 ${budget.activeDate}：已用 ${budget.used.totalTokens.toLocaleString('en-US')} tokens（input ${budget.used.inputTokens.toLocaleString('en-US')}，cached input ${budget.used.cachedInputTokens.toLocaleString('en-US')}，output ${budget.used.outputTokens.toLocaleString('en-US')}，reasoning ${budget.used.reasoningTokens.toLocaleString('en-US')}）與 ${usedCost}；目前預留 ${budget.reserved.tokens.toLocaleString('en-US')} tokens / US$${budget.reserved.estimatedCostUsd.toFixed(6)}。下次本機重設：${new Date(budget.nextLocalReset).toLocaleString('zh-Hant')}。`;
  const unavailable = !pricing.estimatedCostBudgetAvailable;
  pricingStatus.textContent = unavailable
    ? `價格 catalog 檢查日：${pricing.checkedDate}。目前模型價格未知；保留 token hard limit，不套用 estimated-cost limit 或估算。`
    : `價格 catalog 檢查日：${pricing.checkedDate}。${pricing.stale ? '警告：catalog 已超過 90 天，請先確認價格再依賴成本估算。' : 'catalog 尚未過期。'}`;
  pricingStatus.classList.toggle('warning', pricing.stale || unavailable);
  openAiUsageDashboard.href = pricing.usageDashboardUrl;
}

function renderModelControls(
  selected: OpenAiConfiguration['efforts'] = DEFAULT_OPENAI_CONFIGURATION.efforts,
): void {
  const custom = openAiModel.value === 'custom';
  customModelField.hidden = !custom;
  customOpenAiModel.required = custom;
  activateOpenAi.textContent = custom ? '測試並啟用' : '儲存並啟用';
  const available: readonly ReasoningEffort[] = custom
    ? CUSTOM_REASONING_EFFORTS
    : CURATED_REASONING_EFFORTS;
  const effortFields: Array<{
    field: HTMLSelectElement;
    selected: ReasoningEffort;
    fallback: ReasoningEffort;
  }> = [
    {
      field: quickHintEffort,
      selected: selected.quickHint,
      fallback: DEFAULT_OPENAI_CONFIGURATION.efforts.quickHint,
    },
    {
      field: deepDiveEffort,
      selected: selected.deepDive,
      fallback: DEFAULT_OPENAI_CONFIGURATION.efforts.deepDive,
    },
    {
      field: reviewEffort,
      selected: selected.review,
      fallback: DEFAULT_OPENAI_CONFIGURATION.efforts.review,
    },
  ];
  for (const effortField of effortFields) {
    effortField.field.replaceChildren(
      ...available.map((effort) => {
        const option = document.createElement('option');
        option.value = effort;
        option.textContent = effort;
        return option;
      }),
    );
    effortField.field.value = available.includes(effortField.selected)
      ? effortField.selected
      : effortField.fallback;
  }
}

function reasoningEffortFromField(
  field: HTMLSelectElement,
): ReasoningEffort {
  const effort = CUSTOM_REASONING_EFFORTS.find(
    (candidate) => candidate === field.value,
  );
  if (effort === undefined) {
    throw new Error(`Unknown reasoning effort: ${field.value}`);
  }
  return effort;
}

function renderInstructionCount(): void {
  const measured = codePointLength(personalInstructions.value);
  personalInstructionsCount.textContent =
    `${measured.toLocaleString('en-US')} / ${PERSONAL_INSTRUCTIONS_LIMIT.toLocaleString('en-US')}`;
  personalInstructionsCount.classList.toggle(
    'error',
    measured > PERSONAL_INSTRUCTIONS_LIMIT,
  );
}

function renderProbeUsage(
  probes: Extract<OpenAiSettingsResponse, { status: 'activated' }>['probes'],
): void {
  openAiProbeUsage.replaceChildren(
    ...probes.map((probe) =>
      createListItem(
        `${probe.effort}：input ${probe.usage.inputTokens.toLocaleString('en-US')}（cached ${probe.usage.cachedInputTokens.toLocaleString('en-US')}）、output ${probe.usage.outputTokens.toLocaleString('en-US')}（reasoning ${probe.usage.reasoningTokens.toLocaleString('en-US')}）、total ${probe.usage.totalTokens.toLocaleString('en-US')}`,
      ),
    ),
  );
}

function setOpenAiBusy(busy: boolean): void {
  for (const control of openAiForm.elements) {
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    ) {
      control.disabled = busy;
    }
  }
  removeOpenAiApiKey.disabled = busy || !hasStoredOpenAiApiKey;
}

async function sendOpenAiSettingsMessage(
  message: OpenAiSettingsRequest,
): Promise<OpenAiSettingsResponse> {
  const response: unknown = await browser.runtime.sendMessage(message);
  return parseOpenAiSettingsResponse(response);
}

async function renderEvidencePackStatus(): Promise<void> {
  setEvidencePackBusy(true);
  try {
    const response = await sendEvidencePackMessage({
      type: 'get-evidence-pack-status',
    });
    if (response.status === 'failed') {
      evidencePackStatus.textContent = response.message;
      return;
    }
    if (response.status !== 'loaded') {
      evidencePackStatus.textContent = 'Evidence Pack 狀態回應不完整。';
      return;
    }
    applyEvidencePackSnapshot(response.snapshot);
    evidencePackStatus.textContent =
      response.snapshot.state.activeVersion === null
        ? `目前使用內建 known-good ${BUNDLED_EVIDENCE_PACK_VERSION}；可檢查完整 Evidence Pack。`
        : '目前 active pointer 與已驗證 package 已從本機儲存空間復原。';
  } catch {
    evidencePackStatus.textContent =
      '無法讀取 Evidence Pack 狀態；目前 active pointer 未變更。';
  } finally {
    setEvidencePackBusy(false);
  }
}

async function inspectSupportedEvidencePack(): Promise<void> {
  const release = SUPPORTED_EVIDENCE_PACK_RELEASES[0];
  if (release === undefined) {
    evidencePackStatus.textContent = '此擴充功能沒有支援的 Evidence Pack release。';
    return;
  }
  evidencePackStatus.textContent =
    '正在下載並驗證 manifest 簽章、來源、授權、大小與 SHA-256…';
  evidencePackDisclosure.hidden = true;
  stagedEvidencePackCandidateId = null;
  setEvidencePackBusy(true);
  try {
    const response = await sendEvidencePackMessage({
      type: 'inspect-evidence-pack',
      language: release.language,
      version: release.version,
    });
    if (response.status === 'failed') {
      evidencePackStatus.textContent = response.message;
      return;
    }
    if (response.status !== 'awaiting-confirmation') {
      evidencePackStatus.textContent = 'Evidence Pack 檢查回應不完整。';
      return;
    }
    stagedEvidencePackCandidateId = response.inspection.candidateId;
    evidencePackSizeDisclosure.textContent =
      `${response.inspection.version} 已通過驗證。下載大小 ${formatByteCount(response.inspection.compressedSizeBytes)}；安裝大小 ${formatByteCount(response.inspection.installedSizeBytes)}；${response.inspection.sourceCount} 個 pinned sources。`;
    evidencePackAttributions.replaceChildren(
      ...response.inspection.attributions.map(createListItem),
    );
    evidencePackDisclosure.hidden = false;
    evidencePackStatus.textContent =
      '候選版本只存於 staging；請檢查 disclosure 後明確確認，才會改變 active pointer。';
    confirmEvidencePack.focus();
  } catch {
    evidencePackStatus.textContent =
      '無法檢查 Evidence Pack；目前 active pointer 未變更。';
  } finally {
    setEvidencePackBusy(false);
  }
}

async function activateInspectedEvidencePack(): Promise<void> {
  if (stagedEvidencePackCandidateId === null) {
    evidencePackStatus.textContent = '請先檢查並下載 Evidence Pack。';
    return;
  }
  const candidateId = stagedEvidencePackCandidateId;
  setEvidencePackBusy(true);
  try {
    const response = await sendEvidencePackMessage({
      type: 'confirm-evidence-pack-activation',
      candidateId,
    });
    if (response.status === 'failed') {
      evidencePackStatus.textContent = response.message;
      return;
    }
    if (response.status !== 'activated') {
      evidencePackStatus.textContent = 'Evidence Pack 啟用回應不完整。';
      return;
    }
    applyEvidencePackSnapshot(response.snapshot);
    stagedEvidencePackCandidateId = null;
    evidencePackDisclosure.hidden = true;
    evidencePackStatus.textContent =
      `已原子啟用 ${response.snapshot.state.activeVersion}；舊版與既有 Review Item provenance 均未改寫。`;
    inspectEvidencePack.focus();
  } catch {
    evidencePackStatus.textContent =
      'Evidence Pack 啟用失敗；目前 active pointer 未變更。';
  } finally {
    setEvidencePackBusy(false);
  }
}

async function rollbackActiveEvidencePack(): Promise<void> {
  setEvidencePackBusy(true);
  try {
    const response = await sendEvidencePackMessage({
      type: 'rollback-evidence-pack',
    });
    if (response.status === 'failed') {
      evidencePackStatus.textContent = response.message;
      return;
    }
    if (response.status !== 'rolled-back') {
      evidencePackStatus.textContent = 'Evidence Pack rollback 回應不完整。';
      return;
    }
    applyEvidencePackSnapshot(response.snapshot);
    evidencePackDisclosure.hidden = true;
    stagedEvidencePackCandidateId = null;
    evidencePackStatus.textContent =
      `已原子回復 ${activeEvidencePackVersion(response.snapshot)}；受影響 Review Items 已排入 background-budgeted revalidation。`;
    inspectEvidencePack.focus();
  } catch {
    evidencePackStatus.textContent =
      'Evidence Pack rollback 失敗；目前 active pointer 未變更。';
  } finally {
    setEvidencePackBusy(false);
  }
}

function applyEvidencePackSnapshot(
  snapshot: EvidencePackStatusSnapshot,
): void {
  const { activeVersion, rollbackVersion } = snapshot.state;
  activeEvidencePack.textContent = activeEvidencePackVersion(snapshot);
  rollbackEvidencePack.textContent = rollbackVersion ?? '無';
  evidencePackRollbackAvailable = rollbackVersion !== null;
  const release = snapshot.supportedReleases[0];
  inspectEvidencePack.textContent =
    release === undefined
      ? '沒有支援的 Evidence Pack'
      : activeVersion === null
        ? `檢查並下載 ${release.version}`
        : activeVersion === release.version
          ? `重新驗證 ${release.version}`
          : `檢查更新 ${release.version}`;
}

function activeEvidencePackVersion(
  snapshot: EvidencePackStatusSnapshot,
): string {
  return snapshot.state.activeVersion ?? BUNDLED_EVIDENCE_PACK_VERSION;
}

function setEvidencePackBusy(busy: boolean): void {
  inspectEvidencePack.disabled = busy;
  confirmEvidencePack.disabled =
    busy || stagedEvidencePackCandidateId === null;
  rollbackEvidencePackButton.disabled =
    busy || !evidencePackRollbackAvailable;
}

function formatByteCount(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat('zh-Hant', { maximumFractionDigits: 1 }).format(mebibytes)} MiB`;
}

async function sendEvidencePackMessage(
  message: EvidencePackRequest,
): Promise<EvidencePackResponse> {
  const response: unknown = await browser.runtime.sendMessage(message);
  return parseEvidencePackResponse(response);
}

async function renderEnabledSites(): Promise<void> {
  const registrations =
    await browser.scripting.getRegisteredContentScripts();
  const origins = Array.from(
    new Set(
      registrations
        .filter(({ id }) => isEnabledSiteScriptId(id))
        .flatMap(({ matches }) => matches ?? [])
        .map(originFromMatchPattern)
        .filter((origin): origin is string => origin !== null),
    ),
  ).sort();

  enabledSites.replaceChildren();
  if (origins.length === 0) {
    enabledSites.append(createListItem('目前沒有已啟用的網站。'));
    return;
  }

  for (const origin of origins) {
    const item = createListItem(origin);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '撤銷';
    button.setAttribute('aria-label', `撤銷 ${origin} 的網站存取權`);
    button.addEventListener('click', () => void revokeOrigin(origin));
    item.append(button);
    enabledSites.append(item);
  }
}

async function revokeOrigin(origin: string): Promise<void> {
  const removed = await revokeEnabledSite(origin, {
    removePermission: async (match) =>
      browser.permissions.remove({ origins: [match] }),
    hasRegistration: async (id) =>
      (
        await browser.scripting.getRegisteredContentScripts({
          ids: [id],
        })
      ).length > 0,
    unregister: async (id) =>
      browser.scripting.unregisterContentScripts({ ids: [id] }),
  });
  if (!removed) {
    sitesStatus.textContent = `無法撤銷 ${origin}。`;
    return;
  }
  sitesStatus.textContent = `已撤銷 ${origin}。重新載入該網站後生效。`;
  await renderEnabledSites();
}

async function renderCommandBinding(): Promise<void> {
  const commands = await browser.commands.getAll();
  const command = commands.find(
    (candidate) => candidate.name === 'focus-selection-toolbar',
  );
  commandBinding.textContent = command?.shortcut
    ? `進入選取工具：${command.shortcut}`
    : '進入選取工具：未設定或與其他快速鍵衝突。建議 Windows/Linux 使用 Ctrl+Shift+L，macOS 使用 Command+Shift+L。';
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing Settings element: ${id}`);
  return element as T;
}

function createListItem(text: string): HTMLLIElement {
  const item = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = text;
  item.append(label);
  return item;
}
