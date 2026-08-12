import { revokeEnabledSite } from '../../src/modules/reading-flow/site-access';
import {
  isEnabledSiteScriptId,
  originFromMatchPattern,
} from '../../src/modules/reading-flow/site-permission';
import './style.css';

const enabledSites = requiredElement<HTMLUListElement>('enabled-sites');
const sitesStatus = requiredElement<HTMLParagraphElement>('sites-status');
const commandBinding = requiredElement<HTMLParagraphElement>('command-binding');

void renderEnabledSites();
void renderCommandBinding();

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
