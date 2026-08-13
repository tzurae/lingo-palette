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
const enabledSites = requiredElement<HTMLUListElement>('enabled-sites');
const sitesStatus = requiredElement<HTMLParagraphElement>('sites-status');
const commandBinding = requiredElement<HTMLParagraphElement>('command-binding');
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
openAiModel.addEventListener('change', () => {
  renderModelControls({
    quickHint: reasoningEffortFromField(quickHintEffort),
    deepDive: reasoningEffortFromField(deepDiveEffort),
    review: reasoningEffortFromField(reviewEffort),
  });
});
personalInstructions.addEventListener('input', renderInstructionCount);
renderModelOptions();
renderInstructionCount();

void renderOpenAiSettings();
void renderEnabledSites();
void renderCommandBinding();

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
        `${probe.effort}：input ${probe.usage.inputTokens.toLocaleString('en-US')}、output ${probe.usage.outputTokens.toLocaleString('en-US')}、total ${probe.usage.totalTokens.toLocaleString('en-US')}`,
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
