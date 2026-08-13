import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import type { BrowserContext, Frame, Page, Worker } from 'playwright-core';
import { scriptIdFor } from './modules/reading-flow/site-permission';
import {
  DEFAULT_OPENAI_CONFIGURATION,
  OPENAI_API_KEY_STORAGE_KEY,
  OPENAI_CONFIGURATION_STORAGE_KEY,
} from './modules/openai/configuration-store';
import {
  OPENAI_BUDGET_LEDGER_STORAGE_KEY,
  OPENAI_BUDGET_SETTINGS_STORAGE_KEY,
} from './modules/openai/budget-ledger';

declare const chrome: typeof browser;

const executeFile = promisify(execFile);

const extensionPath = resolve('.output/chrome-mv3');

let context: BrowserContext;
let page: Page;
let worker: Worker;
let origin: string;
let profilePath: string;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/frame') {
      response.end(`<!doctype html><html><body>
        <button id="frame-position">Frame reading position</button>
        <p id="frame-copy" tabindex="0">They agreed to postpone the vote until next week.</p>
      </body></html>`);
      return;
    }

    response.end(`<!doctype html><html><head><title>Lingo Palette Browser Test</title></head><body>
      <main>
        <button id="reading-position">Reading position</button>
        <p id="copy" tabindex="0">The committee decided to postpone the vote until next week.</p>
        <p id="long-copy">${'word '.repeat(4_100)}</p>
        <div style="height: 1200px"></div>
        <p id="edge-copy" style="text-align: right">They will postpone the edge case.</p>
        <iframe src="/frame"></iframe>
      </main>
    </body></html>`);
  });
  const serverReady = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', serverReady.resolve);
  await serverReady.promise;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a local test server port.');
  }
  origin = `http://127.0.0.1:${address.port}`;
  closeServer = () => {
    const closed = Promise.withResolvers<void>();
    server.close((error) =>
      error === undefined ? closed.resolve() : closed.reject(error),
    );
    return closed.promise;
  };
  await executeFile(
    process.execPath,
    ['node_modules/wxt/bin/wxt.mjs', 'build'],
    {
      cwd: resolve('.'),
      windowsHide: true,
      env: { ...process.env, WXT_TEST_BROWSER: 'true' },
    },
  );
  const manifestPath = join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    host_permissions?: string[];
  };
  manifest.host_permissions = [
    ...(manifest.host_permissions ?? []),
    `${origin}/*`,
  ];
  await writeFile(manifestPath, JSON.stringify(manifest));


  profilePath = await mkdtemp(join(tmpdir(), 'lingo-palette-'));
  context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-caret-browsing',
    ],
  });
  
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  await worker.evaluate(
    async ([
      siteOrigin,
      scriptId,
      configurationKey,
      apiKeyKey,
      defaultConfiguration,
    ]) => {
      await chrome.scripting.registerContentScripts([
        {
          id: scriptId,
          js: ['/reading-flow.js'],
          matches: [`${siteOrigin}/*`],
          allFrames: true,
          matchOriginAsFallback: true,
          persistAcrossSessions: true,
        },
      ]);
      await chrome.storage.local.set({
        quickHintTestFixture: {
          simplerExpression: 'delay until a later time',
          explanationCue: '延後原本安排的事情',
        },
        [apiKeyKey]: 'sk-browser-test',
        [configurationKey]: defaultConfiguration,
      });
    },
    [
      origin,
      scriptIdFor(origin),
      OPENAI_CONFIGURATION_STORAGE_KEY,
      OPENAI_API_KEY_STORAGE_KEY,
      DEFAULT_OPENAI_CONFIGURATION,
    ] as const,
  );
  page = await context.newPage();
  await page.goto(origin);
}, 60_000);


afterAll(async () => {
  await context?.close();
  await closeServer?.();
  if (profilePath !== undefined) await rm(profilePath, { recursive: true });
});

describe('unpacked extension Reading Flow', () => {
  it('persists exact current-site access and renders a controlled Quick Hint without stealing page focus', async () => {
    const access = await worker.evaluate(async (siteOrigin) => ({
      granted: await chrome.permissions.contains({
        origins: [`${siteOrigin}/*`],
      }),
      manifest: chrome.runtime.getManifest(),
    }), origin);
    expect(access.granted).toBe(true);
    expect(access.manifest.host_permissions).not.toContain('http://*/*');
    expect(access.manifest.host_permissions).not.toContain('https://*/*');
    const readingTabId = await activeReadingTabId();
    const contentScriptRead = await worker.evaluate(
      async ([tabId, apiKeyStorageKey]) => {
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId },
          func: async (key) => {
            try {
              return await chrome.storage.local.get(key);
            } catch (error) {
              return {
                error:
                  error instanceof Error ? error.message : String(error),
              };
            }
          },
          args: [apiKeyStorageKey],
        });
        return injection?.result;
      },
      [readingTabId, OPENAI_API_KEY_STORAGE_KEY] as const,
    );
    expect(JSON.stringify(contentScriptRead)).not.toContain('sk-browser-test');


    const selectionAt = await selectTextByPointer(page, '#copy', 'postpone');
    const focusAfterSelection = await page.evaluate(
      () => document.activeElement?.id,
    );
    await expect
      .poll(() =>
        page.getByRole('toolbar', { name: 'Lingo Palette 選取工具' }).isVisible(),
      )
      .toBe(true);
    const visibleAt = Number(
      await page
        .locator('[data-lingo-palette-reading-flow]')
        .getAttribute('data-visible-at'),
    );
    expect(visibleAt - selectionAt).toBeGreaterThanOrEqual(0);
    expect(visibleAt - selectionAt).toBeLessThanOrEqual(250);
    expect(focusAfterSelection).toBe('copy');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      focusAfterSelection,
    );

    const quickHintButton = page.getByRole('button', { name: '快速提示' });
    await quickHintButton.click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('快速提示已完成；第 1 次 provider 嘗試成功，共 18 tokens');
    expect(
      await quickHintButton.evaluate(
        (button) =>
          button === (button.getRootNode() as ShadowRoot).activeElement,
      ),
    ).toBe(true);
    await expect
      .poll(() => page.getByText('delay until a later time').isVisible())
      .toBe(true);
    await expect
      .poll(() => page.getByText('延後原本安排的事情').isVisible())
      .toBe(true);
    const providerRequest = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('quickHintTestRequest');
      return stored.quickHintTestRequest;
    });
    expect(providerRequest).toEqual({
      text: 'postpone',
      context: {
        before: expect.stringMatching(/The committee decided to $/),
        after: expect.stringMatching(/^ the vote until next week\./),
      },
    });
  });

  it('reports an over-limit Selection without truncating or enabling Quick Hint', async () => {
    await selectNodeContents(page, '#long-copy');
    const measuredLength = await page.evaluate(
      () => Array.from(document.getSelection()?.toString() ?? '').length,
    );
    expect(measuredLength).toBeGreaterThan(4_000);

    await expect
      .poll(() =>
        page
          .getByText(
            new RegExp(
              `選取內容有 ${measuredLength.toLocaleString('en-US')} 個字元，超過 4,000 個字元上限`,
            ),
          )
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() => page.getByRole('button', { name: '快速提示' }).isDisabled())
      .toBe(true);
    expect(
      await page.evaluate(
        () => Array.from(document.getSelection()?.toString() ?? '').length,
      ),
    ).toBe(measuredLength);
  });

  it('keeps the anchored surface in view at page edges, after scroll, and at 200% zoom', async () => {
    const tabId = await activeReadingTabId();
    await worker.evaluate(
      ([id, zoom]) => chrome.tabs.setZoom(id, zoom),
      [tabId, 2] as const,
    );
    await page.locator('#edge-copy').scrollIntoViewIfNeeded();
    await selectTextByPointer(page, '#edge-copy', 'postpone');
    await expect
      .poll(() =>
        page.getByRole('toolbar', { name: 'Lingo Palette 選取工具' }).isVisible(),
      )
      .toBe(true);
    await assertSurfaceInsideViewport();

    await page.evaluate(() => window.scrollBy(0, -200));
    await assertSurfaceInsideViewport();
    await worker.evaluate(
      ([id, zoom]) => chrome.tabs.setZoom(id, zoom),
      [tabId, 1] as const,
    );
  });

  it('supports keyboard entry and Escape focus restoration in a same-origin frame', async () => {
    const frame = page.frames().find((candidate) => candidate.url().endsWith('/frame'));
    if (frame === undefined) throw new Error('Expected the same-origin frame.');
    await frame.locator('#frame-copy').focus();
    const selectionAt = await selectTextByKeyboard(
      frame,
      '#frame-copy',
      'postpone',
    );
    expect(await frame.evaluate(() => document.getSelection()?.toString())).toBe(
      'postpone',
    );
    expect(await frame.evaluate(() => document.activeElement?.id)).toBe(
      'frame-copy',
    );
    await expect
      .poll(() =>
        frame.getByRole('toolbar', { name: 'Lingo Palette 選取工具' }).isVisible(),
      )
      .toBe(true);
    const visibleAt = Number(
      await frame
        .locator('[data-lingo-palette-reading-flow]')
        .getAttribute('data-visible-at'),
    );
    expect(visibleAt - selectionAt).toBeGreaterThanOrEqual(0);
    expect(visibleAt - selectionAt).toBeLessThanOrEqual(250);
    const shortcut = await worker.evaluate(async () => {
      const commands = await chrome.commands.getAll();
      return commands.find(({ name }) => name === 'focus-selection-toolbar')
        ?.shortcut;
    });
    expect(shortcut).toBe('Ctrl+Shift+Y');
    const activeTabId = await activeReadingTabId();
    await worker.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () =>
          window.dispatchEvent(
            new Event('lingo-palette:focus-selection-toolbar'),
          ),
      });
    }, activeTabId);
    await expect
      .poll(() =>
        frame.getByRole('toolbar', { name: 'Lingo Palette 選取工具' }).isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        frame.getByRole('button', { name: '快速提示' }).evaluate(
          (button) =>
            button === (button.getRootNode() as ShadowRoot).activeElement,
        ),
      )
      .toBe(true);
    await frame.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(() => frame.getByText('delay until a later time').isVisible())
      .toBe(true);


    await page.keyboard.press('Escape');
    await expect
      .poll(() =>
        frame.getByRole('toolbar', { name: 'Lingo Palette 選取工具' }).count(),
      )
      .toBe(0);
    expect(await frame.evaluate(() => document.activeElement?.id)).toBe(
      'frame-copy',
    );
  });

  it('shows the Enabled Site and actual command state in Settings', async () => {
    const extensionOrigin = extensionOriginFrom(worker);
    const settings = await context.newPage();
    await settings.goto(`${extensionOrigin}/options.html`);
    await expect.poll(() => settings.getByText(origin).isVisible()).toBe(true);
    await expect
      .poll(() => settings.getByText(/進入選取工具：/).isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        settings
          .getByRole('button', { name: `撤銷 ${origin} 的網站存取權` })
          .isVisible(),
      )
      .toBe(true);
    await settings.close();
  });

  it('configures a masked local key, exact model, workload efforts, and bounded Personal Instructions', async () => {
    const settings = await context.newPage();
    await settings.goto(`${extensionOriginFrom(worker)}/options.html`);
    const apiKey = settings.getByLabel('OpenAI API key');
    const model = settings.getByLabel('OpenAI 模型');
    const quickHintEffort = settings.getByLabel('Quick Hint effort');
    const deepDiveEffort = settings.getByLabel('Deep Dive effort');
    const reviewEffort = settings.getByLabel('Review Generation 與 evaluation effort');
    const personalInstructions = settings.getByLabel('Personal Instructions');

    await expect.poll(() => apiKey.getAttribute('type')).toBe('password');
    await expect.poll(() => apiKey.inputValue()).toBe('');
    await expect
      .poll(() => apiKey.getAttribute('placeholder'))
      .toBe('已在此裝置儲存');
    await expect
      .poll(() =>
        settings
          .getByText(/瀏覽器、裝置、Chrome profile 或擴充功能套件的控制者仍可擷取/)
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() => settings.getByText(/未授權的 OpenAI 費用/).isVisible())
      .toBe(true);
    await expect.poll(() => model.inputValue()).toBe(
      'gpt-5.4-mini-2026-03-17',
    );
    await expect.poll(() => quickHintEffort.inputValue()).toBe('low');
    await expect.poll(() => deepDiveEffort.inputValue()).toBe('medium');
    await expect.poll(() => reviewEffort.inputValue()).toBe('medium');

    await apiKey.fill('sk-replacement-device-key');
    await expect.poll(() => apiKey.getAttribute('type')).toBe('password');
    await settings.getByLabel('顯示 API key').check();
    await expect.poll(() => apiKey.getAttribute('type')).toBe('text');
    await settings.getByLabel('顯示 API key').uncheck();
    await quickHintEffort.selectOption('high');
    await reviewEffort.selectOption('xhigh');
    await model.selectOption('gpt-5.4-nano-2026-03-17');
    await expect.poll(() => quickHintEffort.inputValue()).toBe('high');
    await expect.poll(() => deepDiveEffort.inputValue()).toBe('medium');
    await expect.poll(() => reviewEffort.inputValue()).toBe('xhigh');
    await settings.getByRole('button', { name: '儲存並啟用' }).click();
    await expect
      .poll(() => settings.locator('#openai-status').textContent())
      .toContain('已啟用 gpt-5.4-nano-2026-03-17');

    await settings.reload();
    await expect.poll(() => model.inputValue()).toBe(
      'gpt-5.4-nano-2026-03-17',
    );
    await expect.poll(() => apiKey.inputValue()).toBe('');
    await expect.poll(() => apiKey.getAttribute('type')).toBe('password');
    await expect
      .poll(() => apiKey.getAttribute('placeholder'))
      .toBe('已在此裝置儲存');

    await model.selectOption('custom');
    await settings
      .getByLabel('Custom OpenAI model ID')
      .fill('ft:gpt-5.4-mini:team:Reading-Exact');
    await quickHintEffort.selectOption('minimal');
    await deepDiveEffort.selectOption('high');
    await reviewEffort.selectOption('max');
    await personalInstructions.fill('Keep Traditional Chinese cues concise.');
    const probeRequestCount = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('openAiTestRequests');
      const requests = Array.isArray(stored.openAiTestRequests)
        ? stored.openAiTestRequests
        : [];
      await chrome.storage.local.set({
        openAiTestResponses: [
          {
            status: 503,
            headers: { 'Retry-After': '0' },
            body: {
              error: {
                code: 'server_error',
                message: 'Temporary probe outage',
              },
            },
          },
        ],
      });
      return requests.length;
    });
    await settings.getByRole('button', { name: '測試並啟用' }).click();
    await expect
      .poll(() => settings.locator('#openai-status').textContent())
      .toContain('全部 3 個 capability probes 通過');
    await expect
      .poll(() => settings.getByText(/minimal：input 11（cached 3）、output 7（reasoning 2）、total 18/).isVisible())
      .toBe(true);
    await expect
      .poll(() => settings.getByText(/high：input 11（cached 3）、output 7（reasoning 2）、total 18/).isVisible())
      .toBe(true);
    await expect
      .poll(() => settings.getByText(/max：input 11（cached 3）、output 7（reasoning 2）、total 18/).isVisible())
      .toBe(true);
    await expect
      .poll(async () =>
        worker.evaluate(async () => {
          const stored = await chrome.storage.local.get('openAiTestRequests');
          return Array.isArray(stored.openAiTestRequests)
            ? stored.openAiTestRequests.length
            : 0;
        }),
      )
      .toBe(probeRequestCount + 4);

    const activated = await worker.evaluate(
      async ([configurationKey, apiKeyKey]) =>
        chrome.storage.local.get([configurationKey, apiKeyKey]),
      [OPENAI_CONFIGURATION_STORAGE_KEY, OPENAI_API_KEY_STORAGE_KEY] as const,
    );
    expect(activated).toEqual({
      [OPENAI_CONFIGURATION_STORAGE_KEY]: {
        model: {
          kind: 'custom',
          id: 'ft:gpt-5.4-mini:team:Reading-Exact',
        },
        efforts: {
          quickHint: 'minimal',
          deepDive: 'high',
          review: 'max',
        },
        personalInstructions: 'Keep Traditional Chinese cues concise.',
      },
      [OPENAI_API_KEY_STORAGE_KEY]: 'sk-replacement-device-key',
    });

    await settings.close();
  });

  it('rejects over-limit instructions and preserves the active configuration when a custom probe fails', async () => {
    const settings = await context.newPage();
    await settings.goto(`${extensionOriginFrom(worker)}/options.html`);
    const personalInstructions = settings.getByLabel('Personal Instructions');
    await personalInstructions.fill('😀'.repeat(4_001));
    await expect
      .poll(() => settings.getByText('4,001 / 4,000').isVisible())
      .toBe(true);
    await settings.getByRole('button', { name: '測試並啟用' }).click();
    await expect
      .poll(() => settings.locator('#openai-status').textContent())
      .toContain('4,001');

    await personalInstructions.fill('');
    await settings
      .getByLabel('Custom OpenAI model ID')
      .fill('gpt-incompatible-exact');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        openAiTestResponses: [
          {
            status: 200,
            body: {
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify({ compatible: true }),
                    },
                  ],
                },
              ],
              usage: {
                input_tokens: 11,
                output_tokens: 7,
                total_tokens: 18,
              },
            },
          },
          {
            status: 400,
            body: {
              error: {
                code: 'invalid_value',
                param: 'reasoning.effort',
                message: 'Unsupported effort',
              },
            },
          },
        ],
      });
    });
    await settings.getByRole('button', { name: '測試並啟用' }).click();
    await expect
      .poll(() => settings.locator('#openai-status').textContent())
      .toContain('模型 \"gpt-incompatible-exact\" 不支援 effort \"high\"');
    await expect
      .poll(() =>
        settings
          .getByText(/minimal：input 11（cached 0）、output 7（reasoning 0）、total 18/)
          .isVisible(),
      )
      .toBe(true);

    const active = await worker.evaluate(
      async (configurationKey) =>
        (await chrome.storage.local.get(configurationKey))[configurationKey],
      OPENAI_CONFIGURATION_STORAGE_KEY,
    );
    expect(active).toMatchObject({
      model: {
        kind: 'custom',
        id: 'ft:gpt-5.4-mini:team:Reading-Exact',
      },
      personalInstructions: 'Keep Traditional Chinese cues concise.',
    });
    await settings.close();
  });

  it('shows, validates, and persists daily hard limits with usage and pricing provenance', async () => {
    const settings = await context.newPage();
    await settings.goto(`${extensionOriginFrom(worker)}/options.html`);
    const tokenLimit = settings.getByLabel('Provider token 上限');
    const costLimit = settings.getByLabel('Estimated-cost 上限（US$）');
    await expect.poll(() => tokenLimit.inputValue()).toBe('100000');
    await expect.poll(() => costLimit.inputValue()).toBe('1');
    await expect
      .poll(() => settings.locator('#budget-usage').textContent())
      .toContain('下次本機重設');
    await expect
      .poll(() => settings.locator('#pricing-status').textContent())
      .toContain('目前模型價格未知');
    await expect
      .poll(() => settings.getByRole('link', { name: '開啟 OpenAI Usage Dashboard' }).getAttribute('href'))
      .toBe('https://platform.openai.com/usage');


    await tokenLimit.fill('');
    await costLimit.fill('');
    await settings.getByRole('button', { name: '儲存每日 hard limits' }).click();
    await expect
      .poll(() => settings.locator('#budget-status').textContent())
      .toContain('不可空白');
    const unchanged = await worker.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key],
      OPENAI_BUDGET_SETTINGS_STORAGE_KEY,
    );
    expect(unchanged).toBeUndefined();
    await tokenLimit.fill('25000');
    await costLimit.fill('0.50');
    await settings.getByRole('button', { name: '儲存每日 hard limits' }).click();
    await expect
      .poll(() => settings.locator('#budget-status').textContent())
      .toContain('已儲存');
    const stored = await worker.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key],
      OPENAI_BUDGET_SETTINGS_STORAGE_KEY,
    );
    expect(stored).toEqual({
      tokenLimit: 25_000,
      estimatedCostUsdLimit: 0.5,
    });
    await settings.close();
  });

  it('prevents a stale custom probe from overwriting a newer curated activation', async () => {
    const settings = await context.newPage();
    await settings.goto(`${extensionOriginFrom(worker)}/options.html`);
    const priorRequests = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('openAiTestRequests');
      await chrome.storage.local.set({
        openAiTestResponses: [
          {
            status: 200,
            delayMs: 200,
            body: {
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify({ compatible: true }),
                    },
                  ],
                },
              ],
              usage: {
                input_tokens: 11,
                output_tokens: 7,
                total_tokens: 18,
              },
            },
          },
        ],
      });
      return Array.isArray(stored.openAiTestRequests)
        ? stored.openAiTestRequests.length
        : 0;
    });

    await settings.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        staleActivation: Promise<unknown>;
      };
      state.staleActivation = chrome.runtime.sendMessage({
        type: 'activate-openai-configuration',
        apiKey: 'sk-stale-custom',
        configuration: {
          model: { kind: 'custom', id: 'gpt-stale-custom' },
          efforts: {
            quickHint: 'low',
            deepDive: 'low',
            review: 'low',
          },
          personalInstructions: '',
        },
      });
    });
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          const stored = await chrome.storage.local.get('openAiTestRequests');
          return Array.isArray(stored.openAiTestRequests)
            ? stored.openAiTestRequests.length
            : 0;
        }),
      )
      .toBe(priorRequests + 1);
    const current = await settings.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'activate-openai-configuration',
        apiKey: 'sk-current-curated',
        configuration: {
          model: { kind: 'curated', id: 'gpt-5.4-mini-2026-03-17' },
          efforts: {
            quickHint: 'low',
            deepDive: 'medium',
            review: 'medium',
          },
          personalInstructions: '',
        },
      }),
    );
    const stale = await settings.evaluate(async () => {
      const state = globalThis as typeof globalThis & {
        staleActivation: Promise<unknown>;
      };
      return state.staleActivation;
    });
    expect(current).toMatchObject({ status: 'activated' });
    expect(stale).toMatchObject({ status: 'failed' });

    const active = await worker.evaluate(
      async (configurationKey) =>
        (await chrome.storage.local.get(configurationKey))[configurationKey],
      OPENAI_CONFIGURATION_STORAGE_KEY,
    );
    expect(active).toMatchObject({
      model: { kind: 'curated', id: 'gpt-5.4-mini-2026-03-17' },
    });
    const restored = await settings.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'activate-openai-configuration',
        apiKey: 'sk-replacement-device-key',
        configuration: {
          model: {
            kind: 'custom',
            id: 'ft:gpt-5.4-mini:team:Reading-Exact',
          },
          efforts: {
            quickHint: 'minimal',
            deepDive: 'high',
            review: 'max',
          },
          personalInstructions: 'Keep Traditional Chinese cues concise.',
        },
      }),
    );
    expect(restored).toMatchObject({ status: 'activated' });
    await settings.close();
  });

  it('serves a matching cache entry offline before reporting an offline cache miss', async () => {
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ openAiTestOnline: true });
      await chrome.storage.local.remove('openAiTestResponses');
    });
    await selectTextByPointer(page, '#copy', 'The committee');
    await page.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('provider 嘗試成功');

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ openAiTestOnline: false });
    });
    try {
      await page.getByRole('button', { name: '快速提示' }).click();
      await expect
        .poll(() => page.getByRole('status').textContent())
        .toContain('本機快取載入；未使用 provider budget');
      await closeReadingFlowSurface();
      await selectTextByPointer(page, '#copy', 'decided to');
      await page.getByRole('button', { name: '快速提示' }).click();
      await expect
        .poll(() => page.getByRole('status').textContent())
        .toContain('目前離線');
    } finally {
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ openAiTestOnline: true });
      });
    }
  });

  it('shows retry waiting, retry exhaustion, and a later successful third attempt', async () => {
    await closeReadingFlowSurface();
    const serverFailure = {
      status: 503,
      headers: { 'Retry-After': '0.3' },
      body: { error: { code: 'server_error', message: 'Temporary outage' } },
    };
    await worker.evaluate(async (responses) => {
      await chrome.storage.local.set({
        openAiTestRequests: [],
        openAiTestResponses: responses,
      });
    }, [serverFailure, serverFailure, serverFailure]);
    await selectTextByPointer(page, '#copy', 'committee decided');
    await page.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('第 1 次嘗試未完成');
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('retry 已用完 3 次');
    const exhaustedRequests = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('openAiTestRequests');
      return stored.openAiTestRequests;
    });
    expect(exhaustedRequests).toHaveLength(3);
    await closeReadingFlowSurface();

    await worker.evaluate(async (responses) => {
      await chrome.storage.local.set({
        openAiTestRequests: [],
        openAiTestResponses: responses,
      });
    }, [
      { ...serverFailure, headers: { 'Retry-After': '0.1' } },
      { ...serverFailure, headers: { 'Retry-After': '0.1' } },
    ]);
    await selectTextByPointer(page, '#copy', 'vote until');
    await page.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('第 3 次 provider 嘗試成功');
  });

  it('cancels active provider work, preserves Selection, and releases its reservation', async () => {
    await closeReadingFlowSurface();
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        openAiTestRequests: [],
        openAiTestResponses: [
          {
            status: 200,
            delayMs: 10_000,
            body: {
              output: [],
              usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            },
          },
        ],
      });
    });
    await replaceCopyAndSelect('cancel active request');
    await page.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(async () =>
        worker.evaluate(async () => {
          const stored = await chrome.storage.local.get('openAiTestRequests');
          return Array.isArray(stored.openAiTestRequests)
            ? stored.openAiTestRequests.length
            : 0;
        }),
      )
      .toBe(1);
    await page.getByRole('button', { name: '取消快速提示' }).click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('已取消 Quick Hint；Selection 仍保留');
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
      'cancel active request',
    );
    await expect
      .poll(async () =>
        worker.evaluate(async (key) => {
          const stored = await chrome.storage.local.get(key);
          const ledger = stored[key];
          return typeof ledger === 'object' &&
            ledger !== null &&
            'reservations' in ledger &&
            typeof ledger.reservations === 'object' &&
            ledger.reservations !== null
            ? Object.keys(ledger.reservations).length
            : -1;
        }, OPENAI_BUDGET_LEDGER_STORAGE_KEY),
      )
      .toBe(0);
  });

  it('surfaces every terminal provider failure without retry and blocks locally at zero', async () => {
    const cases = [
      {
        selection: 'The',
        status: 401,
        code: 'invalid_api_key',
        providerMessage: 'Invalid key',
        expected: 'authentication 失敗',
      },
      {
        selection: 'committee',
        status: 403,
        code: 'permission_denied',
        providerMessage: 'Denied',
        expected: 'permission 失敗',
      },
      {
        selection: 'decided',
        status: 400,
        code: 'invalid_request_error',
        providerMessage: 'Bad input',
        expected: 'malformed request',
      },
      {
        selection: 'vote',
        status: 429,
        code: 'billing_not_active',
        providerMessage: 'No credit',
        expected: 'provider credit 不足',
      },
      {
        selection: 'until',
        status: 429,
        code: 'insufficient_quota',
        providerMessage: 'Quota exhausted',
        expected: 'provider quota 已耗盡',
      },
      {
        selection: 'week',
        status: 429,
        code: 'billing_hard_limit_reached',
        providerMessage: 'Spend limit',
        expected: 'spend limit 已到達',
      },
    ] as const;
    for (const current of cases) {
      await closeReadingFlowSurface();
      await worker.evaluate(async (failure) => {
        await chrome.storage.local.set({
          openAiTestRequests: [],
          openAiTestResponses: [
            {
              status: failure.status,
              body: {
                error: {
                  code: failure.code,
                  message: failure.providerMessage,
                },
              },
            },
          ],
        });
      }, current);
      await replaceCopyAndSelect(current.selection);
      await page.getByRole('button', { name: '快速提示' }).click();
      await expect
        .poll(() => page.getByRole('status').textContent())
        .toContain(current.expected);
      expect(
        await page.evaluate(() => document.getSelection()?.toString()),
      ).toBe(current.selection);
      const requests = await worker.evaluate(async () => {
        const stored = await chrome.storage.local.get('openAiTestRequests');
        return stored.openAiTestRequests;
      });
      expect(requests).toHaveLength(1);
    }

    await closeReadingFlowSurface();
    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({
        [key]: { tokenLimit: 0, estimatedCostUsdLimit: 0.5 },
        openAiTestRequests: [],
      });
    }, OPENAI_BUDGET_SETTINGS_STORAGE_KEY);
    await replaceCopyAndSelect('local budget block');
    await page.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('provider Actions 已由每日上限 0 明確停用');
    const blockedRequests = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('openAiTestRequests');
      return stored.openAiTestRequests;
    });
    expect(blockedRequests).toHaveLength(0);
    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({
        [key]: { tokenLimit: 25_000, estimatedCostUsdLimit: 0.5 },
      });
    }, OPENAI_BUDGET_SETTINGS_STORAGE_KEY);
  });

  it('keeps portable configuration after an offline browser restart while the key remains removable', async () => {
    const settings = await context.newPage();
    await settings.goto(`${extensionOriginFrom(worker)}/options.html`);
    await settings.getByRole('button', { name: '移除已儲存的 API key' }).click();
    await expect
      .poll(() => settings.locator('#openai-status').textContent())
      .toContain('已從此裝置移除 OpenAI API key');
    await expect
      .poll(() =>
        settings
          .getByRole('button', { name: '移除已儲存的 API key' })
          .isDisabled(),
      )
      .toBe(true);
    await settings.close();

    await context.close();
    context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await context.setOffline(true);
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const restartedSettings = await context.newPage();
    await restartedSettings.goto(`${extensionOriginFrom(worker)}/options.html`);

    await expect
      .poll(() => restartedSettings.getByLabel('OpenAI 模型').inputValue())
      .toBe('custom');
    await expect
      .poll(() =>
        restartedSettings.getByLabel('Custom OpenAI model ID').inputValue(),
      )
      .toBe('ft:gpt-5.4-mini:team:Reading-Exact');
    await expect
      .poll(() =>
        restartedSettings
          .getByLabel('OpenAI API key')
          .getAttribute('placeholder'),
      )
      .toBe('尚未儲存');
    const portableState = await worker.evaluate(
      async ([configurationKey, apiKeyKey]) =>
        chrome.storage.local.get([configurationKey, apiKeyKey]),
      [OPENAI_CONFIGURATION_STORAGE_KEY, OPENAI_API_KEY_STORAGE_KEY] as const,
    );
    expect(portableState).toEqual({
      [OPENAI_CONFIGURATION_STORAGE_KEY]: expect.objectContaining({
        model: {
          kind: 'custom',
          id: 'ft:gpt-5.4-mini:team:Reading-Exact',
        },
      }),
    });
  });
});
function extensionOriginFrom(extensionWorker: Worker): string {
  const url = new URL(extensionWorker.url());
  return `${url.protocol}//${url.host}`;
}
async function activeReadingTabId(): Promise<number> {
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id;
  });
  if (tabId === undefined) throw new Error('Expected the active reading tab.');
  return tabId;
}

async function assertSurfaceInsideViewport(): Promise<void> {
  const bounds = await page
    .locator('[data-lingo-palette-reading-flow]')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(viewport.width);
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
}

async function closeReadingFlowSurface(): Promise<void> {
  const close = page.getByRole('button', { name: '關閉 Lingo Palette' });
  if (await close.isVisible()) await close.click();
}




async function replaceCopyAndSelect(text: string): Promise<void> {
  await page.locator('#copy').evaluate((element, value) => {
    element.textContent = value;
  }, text);
  await selectNodeContents(page, '#copy');
}

async function selectTextByPointer(
  pageTarget: Page,
  selector: string,
  text: string,
): Promise<number> {
  const points = await pageTarget.locator(selector).evaluate(
    (element, selectedText) => {
      const node = element.firstChild;
      if (!(node instanceof Text)) throw new Error('Expected a text node.');
      const start = node.data.indexOf(selectedText);
      if (start < 0) throw new Error(`Could not select ${selectedText}.`);
      const range = element.ownerDocument.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + selectedText.length);
      const rect = range.getBoundingClientRect();
      return {
        start: { x: rect.left + 1, y: rect.top + rect.height / 2 },
        end: { x: rect.right - 1, y: rect.top + rect.height / 2 },
      };
    },
    text,
  );
  await pageTarget.mouse.move(points.start.x, points.start.y);
  await pageTarget.mouse.down();
  await pageTarget.mouse.move(points.end.x, points.end.y, { steps: 8 });
  const selectionAt = await pageTarget.evaluate(() => performance.now());
  await pageTarget.mouse.up();
  return selectionAt;
}

async function selectTextByKeyboard(
  target: Page | Frame,
  selector: string,
  text: string,
): Promise<number> {
  const locator = target.locator(selector);
  const content = await locator.textContent();
  if (content === null) throw new Error(`Expected text in ${selector}.`);
  const start = content.indexOf(text);
  if (start < 0) throw new Error(`Could not select ${text}.`);
  await locator.focus();
  await target.press(selector, 'Home');
  for (let index = 0; index < start; index += 1) {
    await target.press(selector, 'ArrowRight');
  }
  const codePoints = Array.from(text);
  for (let index = 0; index < codePoints.length - 1; index += 1) {
    await target.press(selector, 'Shift+ArrowRight');
  }
  const selectionAt = await target.evaluate(() => performance.now());
  await target.press(selector, 'Shift+ArrowRight');
  return selectionAt;
}

async function selectNodeContents(pageTarget: Page, selector: string): Promise<void> {
  await pageTarget.locator(selector).evaluate((element) => {
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
}
