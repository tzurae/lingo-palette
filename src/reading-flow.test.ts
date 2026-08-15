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
import { ACTIVE_EVIDENCE_INDEX_STORAGE_KEY } from './modules/learning/evidence-pack-lookup';
import { LEARNING_STATE_STORAGE_KEY } from './modules/learning/learning-item-store';
import { LOOKUP_RECORDS_STORAGE_KEY } from './modules/learning/lookup-record';
import { EVIDENCE_PACK_STATE_STORAGE_KEY } from './modules/evidence/evidence-pack-browser-adapters';
import { BUNDLED_EVIDENCE_PACK_VERSION } from './modules/evidence/evidence-pack-catalog';
import { SIGNED_EVIDENCE_PACK_FIXTURE } from './modules/evidence/signed-evidence-pack-fixture';
import { BUNDLED_ENGLISH_EVIDENCE_PACK } from './modules/evidence/bundled-english-evidence-pack';
import type { ApprovedReviewItem } from './modules/review/review-generation-harness';
import {
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_EVIDENCE_STORAGE_KEY,
  REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
  REVIEW_SCHEDULES_STORAGE_KEY,
  REVIEW_SESSIONS_STORAGE_KEY,
} from './modules/review/review-storage-keys';

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
        deepDiveTestFixture: {
          contextualMeaning:
            'Here, postpone means deciding that the vote will happen later.',
          usageFit:
            'Neutral and suitable for an official committee decision.',
          grammarPattern: {
            pattern: 'postpone + noun',
            explanation: 'The noun names the delayed event.',
          },
          alternatives: [
            {
              expression: 'put off',
              distinction: 'More conversational than postpone.',
            },
          ],
          examples: [
            {
              sentence: 'The committee postponed the vote.',
              explanation: 'The vote is the delayed event.',
            },
          ],
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


  it('plays disclosed US pronunciation, reuses it offline, and keeps Selection on stop', async () => {
    const speechEvents = [
      'event: speech.audio.delta',
      'data: {"type":"speech.audio.delta","audio":"AQID"}',
      '',
      'event: speech.audio.done',
      'data: {"type":"speech.audio.done","usage":{"input_tokens":14,"output_tokens":999,"total_tokens":1013}}',
      '',
    ].join('\n');
    const budgetBefore = await worker.evaluate(async (key) => {
      const stored = await chrome.storage.local.get(key);
      return stored[key];
    }, OPENAI_BUDGET_LEDGER_STORAGE_KEY);
    await worker.evaluate(async (body) => {
      await chrome.storage.local.set({
        openAiTestOnline: true,
        openAiTestRequests: [],
        openAiTestResponses: [
          {
            status: 500,
            body: {
              error: {
                code: 'server_error',
                message: 'Temporary speech failure.',
              },
              usage: {
                input_tokens: 4,
                output_tokens: 8,
                total_tokens: 12,
              },
            },
          },
          { status: 200, delayMs: 1_000, body },
        ],
      });
    }, speechEvents);

    await selectTextByPointer(page, '#copy', 'postpone');
    const pronunciation = page.getByRole('group', {
      name: 'Pronunciation Playback',
    });
    const pronunciationStatus = pronunciation.locator(
      '.pronunciation-status',
    );
    await pronunciation.getByRole('button', { name: 'US English' }).click();
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toContain('第 1 次語音嘗試未完成');
    await pronunciation.getByRole('button', { name: '暫停' }).click();
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toContain('已暫停');
    await pronunciation.getByRole('button', { name: '繼續' }).click();
    await expect
      .poll(() => pronunciationStatus.textContent(), { timeout: 5_000 })
      .toContain(
        'AI 產生語音 Playback 已完成；voice cedar，variety en-US，2 次 provider 嘗試，共 1,013 tokens',
      );

    const generated = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get([
        'pronunciationTestRequest',
        'openAiTestRequests',
      ]);
      return {
        pronunciationTestRequest: stored.pronunciationTestRequest,
        openAiTestRequests: Array.isArray(stored.openAiTestRequests)
          ? stored.openAiTestRequests
          : [],
      };
    });
    expect(generated.pronunciationTestRequest).toMatchObject({
      selection: { text: 'postpone' },
      variety: 'en-US',
    });
    expect(generated.openAiTestRequests).toHaveLength(2);
    expect(generated.openAiTestRequests.at(-1)).toEqual(
      expect.objectContaining({
        model: 'gpt-4o-mini-tts-2025-12-15',
        voice: 'cedar',
        input: 'postpone',
        response_format: 'mp3',
        stream_format: 'sse',
        instructions: expect.stringContaining('General American English'),
      }),
    );
    const speechTokenDelta = await worker.evaluate(
      async ([key, before]) => {
        const current = (await chrome.storage.local.get(key))[key] as {
          used: { totalTokens: number };
        };
        const prior = before as
          | { used?: { totalTokens?: number } }
          | undefined;
        return current.used.totalTokens - (prior?.used?.totalTokens ?? 0);
      },
      [OPENAI_BUDGET_LEDGER_STORAGE_KEY, budgetBefore] as const,
    );
    expect(speechTokenDelta).toBe(1_025);

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        openAiTestOnline: false,
        openAiTestRequests: [],
      });
    });
    await selectTextByPointer(page, '#copy', 'postpone');
    await pronunciation.getByRole('button', { name: 'US English' }).click();
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toContain('本機快取');
    const offlineRequests = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('openAiTestRequests');
      return stored.openAiTestRequests;
    });
    expect(offlineRequests).toEqual([]);

    await worker.evaluate(async (body) => {
      await chrome.storage.local.set({
        openAiTestOnline: true,
        openAiTestResponses: [
          { status: 200, delayMs: 5_000, body },
        ],
      });
    }, speechEvents);
    await selectTextByPointer(page, '#copy', 'vote');
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toBe('尚未開始 Pronunciation Playback。');
    await expect
      .poll(() =>
        pronunciation.getByRole('button', { name: '暫停' }).isHidden(),
      )
      .toBe(true);
    await pronunciation.getByRole('button', { name: 'UK English' }).click();
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toContain('正在產生 AI 語音');
    await pronunciation.getByRole('button', { name: '停止' }).click();
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toContain('已停止');
    expect(
      await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>(
          '[data-lingo-palette-reading-flow]',
        );
        const focused = host?.shadowRoot?.activeElement;
        return {
          className:
            focused instanceof HTMLElement ? focused.className : null,
          hidden:
            focused instanceof HTMLButtonElement ? focused.hidden : null,
        };
      }),
    ).toEqual({ className: 'secondary pronunciation-stop', hidden: false });
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
      'vote',
    );
    await expect
      .poll(() =>
        worker.evaluate(async (key) => {
          const stored = await chrome.storage.local.get(key);
          const ledger = stored[key] as
            | { reservations?: Record<string, unknown> }
            | undefined;
          return Object.keys(ledger?.reservations ?? {}).length;
        }, OPENAI_BUDGET_LEDGER_STORAGE_KEY),
      )
      .toBe(0);
    await worker.evaluate(
      async ([key, prior]) => {
        if (prior === undefined) await chrome.storage.local.remove(key);
        else await chrome.storage.local.set({ [key]: prior });
        await chrome.storage.local.set({
          openAiTestOnline: true,
          openAiTestResponses: [],
        });
      },
      [OPENAI_BUDGET_LEDGER_STORAGE_KEY, budgetBefore] as const,
    );
  });
  it('opens durable Side Panel Current only for explicit Deep Dive requests', async () => {
    const firstResult = {
      contextualMeaning:
        'Here, postpone means deciding that the vote will happen later.',
      usageFit: 'Neutral and suitable for an official committee decision.',
      grammarPattern: {
        pattern: 'postpone + noun',
        explanation: 'The noun names the delayed event.',
      },
      alternatives: [
        {
          expression: 'put off',
          distinction: 'More conversational than postpone.',
        },
      ],
      examples: [
        {
          sentence: 'The committee postponed the vote.',
          explanation: 'The vote is the delayed event.',
        },
      ],
    };
    await worker.evaluate(async (result) => {
      await chrome.storage.local.set({
        openAiTestResponses: [
          {
            status: 200,
            delayMs: 1_000,
            body: {
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify(result),
                    },
                  ],
                },
              ],
              usage: {
                input_tokens: 80,
                input_tokens_details: { cached_tokens: 10 },
                output_tokens: 120,
                output_tokens_details: { reasoning_tokens: 30 },
                total_tokens: 200,
              },
            },
          },
        ],
        openAiTestRequests: [],
      });
    }, firstResult);

    await selectTextByPointer(page, '#copy', 'postpone');
    await page.getByRole('button', { name: 'Deep Dive' }).click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('Deep Dive 已在 Side Panel 開始');

    let sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await expect
      .poll(() =>
        sidePanel.getByRole('heading', { name: 'Deep Dive in progress' }).isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText(firstResult.contextualMeaning)
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText('postpone + noun')
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText('put off', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText('The committee postponed the vote.')
          .isVisible(),
      )
      .toBe(true);

    await sidePanel.close();
    const unrelatedTab = await context.newPage();
    await unrelatedTab.goto('about:blank');
    sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText(firstResult.contextualMeaning)
          .isVisible(),
      )
      .toBe(true);
    await unrelatedTab.close();

    const currentTab = sidePanel.getByRole('tab', { name: 'Current' });
    await currentTab.focus();
    await currentTab.press('End');
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tab', { name: 'Review' })
          .getAttribute('aria-selected'),
      )
      .toBe('true');
    await sidePanel.getByRole('tab', { name: 'Review' }).press('ArrowLeft');
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tab', { name: 'Saved' })
          .getAttribute('aria-selected'),
      )
      .toBe('true');
    await sidePanel.getByRole('tab', { name: 'Current' }).click();

    await selectTextByPointer(page, '#copy', 'committee');
    await page.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(() => page.getByText('delay until a later time').isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText(/Selection: postpone/, { exact: false })
          .isVisible(),
      )
      .toBe(true);
    expect(await sidePanel.locator('#live-status').textContent()).not.toContain(
      'Recent 已載入',
    );

    const secondResult = {
      ...firstResult,
      contextualMeaning:
        'Here, committee means the group making the decision.',
      grammarPattern: {
        pattern: 'committee + verb',
        explanation: 'The collective noun is the sentence subject.',
      },
    };
    await worker.evaluate(async (result) => {
      await chrome.storage.local.set({
        deepDiveTestFixture: result,
        openAiTestResponses: [],
      });
    }, secondResult);
    await selectTextByPointer(page, '#copy', 'committee');
    await page.getByRole('button', { name: 'Deep Dive' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText(secondResult.contextualMeaning)
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText(/Selection: committee/, { exact: false })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText(firstResult.contextualMeaning)
          .count(),
      )
      .toBe(0);

    await worker.evaluate(async (result) => {
      await chrome.storage.local.set({
        openAiTestResponses: [
          {
            status: 200,
            delayMs: 10_000,
            body: {
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify(result),
                    },
                  ],
                },
              ],
              usage: {
                input_tokens: 80,
                output_tokens: 120,
                total_tokens: 200,
              },
            },
          },
        ],
      });
    }, firstResult);
    await selectTextByPointer(page, '#copy', 'vote');
    await page.getByRole('button', { name: 'Deep Dive' }).click();
    await expect
      .poll(() =>
        sidePanel.getByRole('heading', { name: 'Deep Dive in progress' }).isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText(/Selection: committee/, { exact: false })
          .isVisible(),
      )
      .toBe(true);
    await sidePanel.getByRole('button', { name: '取消 Deep Dive' }).click();
    await expect
      .poll(() =>
        sidePanel.getByRole('heading', { name: 'Deep Dive cancelled' }).isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByText(/Requested Selection: vote/, { exact: false })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .evaluate((panel) => document.activeElement === panel),
      )
      .toBe(true);

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        openAiTestResponses: [
          {
            status: 401,
            body: {
              error: {
                code: 'invalid_api_key',
                message: 'Invalid key',
              },
            },
          },
        ],
      });
    });
    await sidePanel.getByRole('button', { name: '重試 Deep Dive' }).click();
    await expect
      .poll(() =>
        sidePanel.getByRole('heading', { name: 'Deep Dive failed' }).isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('heading', { name: 'Deep Dive failed' })
          .locator('..')
          .getByText(/authentication 失敗/)
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('tabpanel', { name: 'Current' })
          .getByText(/Selection: committee/, { exact: false })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByRole('button', { name: '重試 Deep Dive' })
          .isVisible(),
      )
      .toBe(true);
    const lookupRecords = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('lookupRecordsV1');
      return stored.lookupRecordsV1;
    });
    expect(lookupRecords).toEqual(
      expect.objectContaining({
        version: 1,
        records: expect.arrayContaining([
          expect.objectContaining({
            version: 1,
            action: expect.objectContaining({ type: 'quick-hint' }),
          }),
          expect.objectContaining({
            version: 1,
            action: expect.objectContaining({ type: 'deep-dive' }),
          }),
        ]),
      }),
    );
    expect(
      (lookupRecords as { records: Array<{ selection: { text: string } }> })
        .records.some((record) => record.selection.text === 'vote'),
    ).toBe(false);


    const requests = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('openAiTestRequests');
      return Array.isArray(stored.openAiTestRequests)
        ? stored.openAiTestRequests
        : [];
    });
    const deepDiveRequests = requests.filter(
      (request: { text?: { format?: { name?: string } } }) =>
        request.text?.format?.name === 'deep_dive',
    );
    expect(deepDiveRequests).toHaveLength(4);
    expect(deepDiveRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasoning: { effort: 'medium' },
          store: false,
          text: {
            format: expect.objectContaining({
              name: 'deep_dive',
              strict: true,
            }),
          },
        }),
      ]),
    );
    await sidePanel.close();
  }, 60_000);

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
              `選取內容有 ${measuredLength.toLocaleString('en-US')} 個字元，超過 Quick Hint 與 Deep Dive 的 4,000 個字元上限；Pronunciation Playback 仍可使用`,
            ),
          )
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() => page.getByRole('button', { name: '快速提示' }).isDisabled())
      .toBe(true);
    await expect
      .poll(() => page.getByRole('button', { name: 'Deep Dive' }).isDisabled())
      .toBe(true);
    await expect
      .poll(() =>
        page.getByRole('button', { name: 'US English' }).isEnabled(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.getByRole('button', { name: 'UK English' }).isEnabled(),
      )
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

  it('installs a signed Evidence Pack and recovers the active pack after an offline browser restart', async () => {
    const assetBytes = new Map([
      [
        'manifest.json',
        Buffer.from(
          SIGNED_EVIDENCE_PACK_FIXTURE.manifestBase64,
          'base64',
        ),
      ],
      [
        'manifest.sig',
        Buffer.from(
          SIGNED_EVIDENCE_PACK_FIXTURE.signatureBase64,
          'base64',
        ),
      ],
      [
        'evidence-pack.json.gz',
        Buffer.from(
          SIGNED_EVIDENCE_PACK_FIXTURE.payloadBase64,
          'base64',
        ),
      ],
    ]);
    await context.route(
      'https://tzurae.github.io/lingo-palette-evidence/**',
      async (route) => {
        const asset = new URL(route.request().url()).pathname.split('/').at(-1);
        const body = asset === undefined ? undefined : assetBytes.get(asset);
        if (body === undefined) {
          await route.abort('failed');
          return;
        }
        await route.fulfill({
          status: 200,
          headers: { 'Content-Length': String(body.byteLength) },
          body,
        });
      },
    );
    const settings = await context.newPage();
    await settings.goto(`${extensionOriginFrom(worker)}/options.html`);
    await expect
      .poll(() => settings.locator('#inspect-evidence-pack').count())
      .toBe(1);
    await settings.locator('#inspect-evidence-pack').click();
    await expect
      .poll(() => settings.locator('#evidence-pack-status').textContent())
      .toContain('候選版本只存於 staging');
    await settings.locator('#confirm-evidence-pack').click();
    await expect
      .poll(() => settings.locator('#evidence-pack-status').textContent())
      .toContain('已原子啟用 2025.1.0');
    expect(
      await worker.evaluate(
        async (key) => (await chrome.storage.local.get(key))[key],
        EVIDENCE_PACK_STATE_STORAGE_KEY,
      ),
    ).toMatchObject({
      activeVersion: '2025.1.0',
      rollbackVersion: BUNDLED_EVIDENCE_PACK_VERSION,
    });

    await settings.close();
    await context.close();
    context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      offline: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async ([siteOrigin, scriptId]) => {
        const registrations =
          await chrome.scripting.getRegisteredContentScripts();
        if (registrations.some(({ id }) => id === scriptId)) return;
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
      },
      [origin, scriptIdFor(origin)] as const,
    );
    const restartedSettings = await context.newPage();
    await restartedSettings.goto(
      `${extensionOriginFrom(worker)}/options.html`,
    );
    await expect
      .poll(() =>
        restartedSettings.locator('#active-evidence-pack').textContent(),
      )
      .toBe('2025.1.0');
    await expect
      .poll(() =>
        restartedSettings
          .locator('#rollback-evidence-pack-button')
          .isDisabled(),
      )
      .toBe(false);
    await restartedSettings.locator('#rollback-evidence-pack-button').click();
    await expect
      .poll(() =>
        restartedSettings.locator('#active-evidence-pack').textContent(),
      )
      .toBe(BUNDLED_EVIDENCE_PACK_VERSION);
    await restartedSettings.close();

    await context.setOffline(false);
    page = await context.newPage();
    await page.goto(origin);
  }, 60_000);

  it('recovers a completed Lookup in Recent after an offline browser restart while Saved remains empty', async () => {
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        openAiTestOnline: true,
        openAiTestResponses: [],
        quickHintTestFixture: {
          simplerExpression: '<img src=x onerror=alert(1)>',
          explanationCue: '[data-command=\"erase\"]',
        },
      });
    });
    await replaceCopyAndSelect('offline Recent lookup');
    await page.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toContain('快速提示已完成');

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
      offline: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
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
    const sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await sidePanel.getByRole('tab', { name: 'Recent' }).click();
    await expect
      .poll(() => sidePanel.getByText('offline Recent lookup').isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel.getByText('<img src=x onerror=alert(1)>').isVisible(),
      )
      .toBe(true);
    expect(await sidePanel.locator('img').count()).toBe(0);
    await sidePanel.getByRole('tab', { name: 'Saved' }).click();
    await expect
      .poll(() =>
        sidePanel.getByText('目前沒有已儲存的 Learning Items。').isVisible(),
      )
      .toBe(true);
  }, 60_000);

  it('saves, classifies, resolves, undoes, and recovers Learning Items offline', async () => {
    await worker.evaluate(
      async ([lookupKey, evidenceKey, learningKey]) => {
        const quickHint = {
          type: 'quick-hint' as const,
          result: {
            simplerExpression: 'controlled result',
            explanationCue: null,
          },
        };
        const usage = { source: 'cache' as const, attempts: 0, provider: null };
        await chrome.storage.local.remove(learningKey);
        await chrome.storage.local.set({
          [lookupKey]: {
            version: 1,
            records: [
              {
                version: 1,
                id: 'lookup-bank-2',
                selection: {
                  text: 'Bank',
                  context: { before: 'She visited the ', after: ' for a loan.' },
                },
                action: quickHint,
                completedAt: '2026-08-14T14:04:00.000Z',
                usage,
                sourceUrl: 'https://finance.example/article',
              },
              {
                version: 1,
                id: 'lookup-bank-1',
                selection: {
                  text: 'bank',
                  context: { before: 'They sat on the river ', after: ' at sunset.' },
                },
                action: quickHint,
                completedAt: '2026-08-14T14:03:00.000Z',
                usage,
                sourceUrl: 'https://nature.example/article',
              },
              {
                version: 1,
                id: 'lookup-postponed-2',
                selection: {
                  text: 'Postponed',
                  context: { before: 'The board ', after: ' its decision.' },
                },
                action: quickHint,
                completedAt: '2026-08-14T14:02:00.000Z',
                usage,
                sourceUrl: 'https://board.example/article',
              },
              {
                version: 1,
                id: 'lookup-postponed-1',
                selection: {
                  text: 'postponed',
                  context: { before: 'They ', after: ' the vote.' },
                },
                action: quickHint,
                completedAt: '2026-08-14T14:01:00.000Z',
                usage,
                sourceUrl: 'https://news.example/article',
              },
            ],
          },
          [evidenceKey]: {
            version: 1,
            evidencePackVersion: 'oewn-browser-test-2025.1',
            entries: [
              {
                normalizedExpression: 'postponed',
                morphology: 'past-tense-of:postpone',
                partOfSpeech: 'verb',
                sourceSenseId: 'oewn:02642814-v',
              },
              {
                normalizedExpression: 'bank',
                morphology: 'lemma',
                partOfSpeech: 'noun',
                sourceSenseId: 'oewn:09213565-n',
              },
              {
                normalizedExpression: 'bank',
                morphology: 'lemma',
                partOfSpeech: 'noun',
                sourceSenseId: 'oewn:08420278-n',
              },
            ],
            occurrenceAnalyses: [
              {
                lookupRecordId: 'lookup-postponed-1',
                normalizedExpression: 'postponed',
                morphology: 'past-tense-of:postpone',
                partOfSpeech: 'verb',
              },
              {
                lookupRecordId: 'lookup-postponed-2',
                normalizedExpression: 'postponed',
                morphology: 'past-tense-of:postpone',
                partOfSpeech: 'verb',
              },
              {
                lookupRecordId: 'lookup-bank-1',
                normalizedExpression: 'bank',
                morphology: 'lemma',
                partOfSpeech: 'noun',
              },
              {
                lookupRecordId: 'lookup-bank-2',
                normalizedExpression: 'bank',
                morphology: 'lemma',
                partOfSpeech: 'noun',
              },
            ],
          },
        });
      },
      [
        LOOKUP_RECORDS_STORAGE_KEY,
        ACTIVE_EVIDENCE_INDEX_STORAGE_KEY,
        LEARNING_STATE_STORAGE_KEY,
      ] as const,
    );

    let sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await sidePanel.getByRole('tab', { name: 'Recent' }).click();
    const saveLookup = async (selection: string) => {
      const card = sidePanel.locator('.lookup-record').filter({
        has: sidePanel.getByText(`Selection: ${selection}`, { exact: true }),
      });
      await card.getByRole('button', { name: '儲存到 Saved' }).click();
      await expect
        .poll(() => card.getByRole('button', { name: '已儲存' }).isDisabled())
        .toBe(true);
    };
    await saveLookup('postponed');
    await saveLookup('Postponed');
    await saveLookup('bank');
    await saveLookup('Bank');

    await sidePanel.getByRole('tab', { name: 'Saved' }).click();
    const savedPanel = sidePanel.getByRole('tabpanel', { name: 'Saved' });
    const postponedItem = savedPanel
      .locator('.learning-item')
      .filter({ hasText: 'Normalized expression: postponed' });
    await expect
      .poll(() => postponedItem.getByText('They postponed the vote.').isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        postponedItem
          .getByText('The board Postponed its decision.')
          .isVisible(),
      )
      .toBe(true);

    let suggestion = savedPanel
      .locator('.merge-suggestion')
      .filter({ hasText: 'They sat on the river bank at sunset.' })
      .filter({ hasText: 'She visited the Bank for a loan.' });
    await expect
      .poll(() => suggestion.getByText('lookup-bank-1', { exact: false }).isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        suggestion
          .getByText('https://finance.example/article', { exact: false })
          .isVisible(),
      )
      .toBe(true);
    await suggestion.getByRole('button', { name: '合併' }).click();
    const bankItem = savedPanel
      .locator('.learning-item')
      .filter({ hasText: 'They sat on the river bank at sunset.' });
    await expect
      .poll(() => bankItem.getByText('She visited the Bank for a loan.').isVisible())
      .toBe(true);

    const learnerMergeHistory = savedPanel
      .locator('.learning-mutation')
      .filter({ hasText: 'Learner 合併' });
    await expect
      .poll(() =>
        learnerMergeHistory
          .getByText('lookup-bank-1', { exact: false })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        learnerMergeHistory
          .getByText('lookup-bank-2', { exact: false })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        learnerMergeHistory
          .getByText('https://finance.example/article', { exact: false })
          .isVisible(),
      )
      .toBe(true);
    await learnerMergeHistory.getByRole('button', { name: '復原' }).click();
    suggestion = savedPanel
      .locator('.merge-suggestion')
      .filter({ hasText: 'They sat on the river bank at sunset.' })
      .filter({ hasText: 'She visited the Bank for a loan.' });
    await expect.poll(() => suggestion.isVisible()).toBe(true);
    await suggestion.getByRole('button', { name: '保持分開' }).click();
    await expect
      .poll(() => savedPanel.getByText('已選擇保持分開').isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        savedPanel.getByRole('button', { name: '復原' }).count(),
      )
      .toBe(1);
    const latestMutation = savedPanel
      .locator('.learning-mutation')
      .filter({ hasText: '保持分開' });
    const mutationIdText = await latestMutation
      .locator('p')
      .filter({ hasText: 'Mutation ID' })
      .textContent();
    const mutationId = mutationIdText?.replace('Mutation ID: ', '');
    if (mutationId === undefined) throw new Error('Expected mutation ID.');
    const latestUndo = latestMutation.getByRole('button', { name: '復原' });
    await latestUndo.evaluate(
      async (button: HTMLButtonElement, staleMutationId) => {
        button.focus();
        await chrome.runtime.sendMessage({
          type: 'undo-learning-mutation',
          mutationId: staleMutationId,
        });
        if (button.isConnected) {
          const { promise, resolve } = Promise.withResolvers<void>();
          const observer = new MutationObserver(() => {
            if (button.isConnected) return;
            observer.disconnect();
            resolve();
          });
          observer.observe(document, { childList: true, subtree: true });
          await promise;
        }
        button.click();
      },
      mutationId,
    );
    await expect
      .poll(() => savedPanel.locator('#saved-error').isVisible())
      .toBe(true);
    await expect
      .poll(() => postponedItem.getByText('They postponed the vote.').isVisible())
      .toBe(true);
    suggestion = savedPanel
      .locator('.merge-suggestion')
      .filter({ hasText: 'They sat on the river bank at sunset.' })
      .filter({ hasText: 'She visited the Bank for a loan.' });
    await expect.poll(() => suggestion.isVisible()).toBe(true);
    await suggestion.getByRole('button', { name: '保持分開' }).click();
    await expect
      .poll(() => savedPanel.locator('#saved-error').isHidden())
      .toBe(true);

    const productiveIntent = postponedItem.getByRole('checkbox', {
      name: 'Productive-use Intent',
    });
    await productiveIntent.check();
    await expect.poll(() => productiveIntent.isChecked()).toBe(true);

    await sidePanel.close();
    await context.close();
    context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      offline: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await sidePanel.getByRole('tab', { name: 'Saved' }).click();
    const recoveredPostponedItem = sidePanel
      .locator('.learning-item')
      .filter({ hasText: 'Normalized expression: postponed' });
    const recoveredBankItem = sidePanel
      .locator('.learning-item')
      .filter({ hasText: 'She visited the Bank for a loan.' });
    await expect
      .poll(() =>
        recoveredPostponedItem
          .getByText('They postponed the vote.')
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        recoveredBankItem
          .getByText('She visited the Bank for a loan.')
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .locator('.learning-item')
          .filter({ hasText: 'Normalized expression: postponed' })
          .getByRole('checkbox', { name: 'Productive-use Intent' })
          .isChecked(),
      )
      .toBe(true);
    await expect
      .poll(() => sidePanel.getByText('已選擇保持分開').isVisible())
      .toBe(true);
  }, 60_000);

  it('records layered evidence, resumes an objective Review Session offline, and advances its schedule', async () => {
    await worker.evaluate(
      async ([
        lookupKey,
        evidenceKey,
        learningKey,
        approvedKey,
        schedulesKey,
        sessionsKey,
        markersKey,
        reviewEvidenceKey,
      ]) => {
        await chrome.storage.local.remove([
          learningKey,
          approvedKey,
          schedulesKey,
          sessionsKey,
          markersKey,
          reviewEvidenceKey,
        ]);
        await chrome.storage.local.set({
          [lookupKey]: {
            version: 1,
            records: [
              {
                version: 1,
                id: 'review-lookup',
                selection: {
                  text: 'postponed',
                  context: { before: 'They ', after: ' the vote.' },
                },
                action: {
                  type: 'quick-hint',
                  result: {
                    simplerExpression: 'delayed',
                    explanationCue: null,
                  },
                },
                completedAt: '2026-08-15T11:00:00.000Z',
                usage: { source: 'cache', attempts: 0, provider: null },
                sourceUrl: 'https://news.example/article',
              },
            ],
          },
          [evidenceKey]: {
            version: 1,
            evidencePackVersion: 'oewn-browser-test-2025.1',
            entries: [
              {
                normalizedExpression: 'postponed',
                morphology: 'past-tense-of:postpone',
                partOfSpeech: 'verb',
                sourceSenseId: 'oewn:02642814-v',
              },
            ],
            occurrenceAnalyses: [
              {
                lookupRecordId: 'review-lookup',
                normalizedExpression: 'postponed',
                morphology: 'past-tense-of:postpone',
                partOfSpeech: 'verb',
              },
            ],
          },
        });
      },
      [
        LOOKUP_RECORDS_STORAGE_KEY,
        ACTIVE_EVIDENCE_INDEX_STORAGE_KEY,
        LEARNING_STATE_STORAGE_KEY,
        APPROVED_REVIEW_ITEMS_STORAGE_KEY,
        REVIEW_SCHEDULES_STORAGE_KEY,
        REVIEW_SESSIONS_STORAGE_KEY,
        REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
        REVIEW_EVIDENCE_STORAGE_KEY,
      ] as const,
    );

    let sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await sidePanel.getByRole('tab', { name: 'Recent' }).click();
    const lookup = sidePanel.locator('.lookup-record').filter({
      has: sidePanel.getByText('Selection: postponed', { exact: true }),
    });
    await lookup.getByRole('button', { name: '儲存到 Saved' }).click();
    await expect
      .poll(() => lookup.getByRole('button', { name: '已儲存' }).isDisabled())
      .toBe(true);
    const learningItemId = await worker.evaluate(async (key) => {
      const raw = (await chrome.storage.local.get(key))[key];
      if (
        raw === null ||
        typeof raw !== 'object' ||
        !('learningItems' in raw) ||
        !Array.isArray(raw.learningItems)
      ) {
        throw new Error('Expected durable Learning Item state.');
      }
      const first = raw.learningItems[0];
      if (
        first === null ||
        typeof first !== 'object' ||
        !('id' in first) ||
        typeof first.id !== 'string'
      ) {
        throw new Error('Expected one saved Learning Item.');
      }
      return first.id;
    }, LEARNING_STATE_STORAGE_KEY);
    const reviewItem: ApprovedReviewItem = {
      version: 1,
      id: 'approved-review-postponed',
      learningItemId,
      knowledgeDimension: 'contextual-meaning',
      task: {
        type: 'contrastive',
        prompt: '<img src=x onerror=alert(1)> Which meaning fits?',
        contextQuote: 'They postponed the vote.',
        targetAnswers: ['<svg onload=alert(2)> delayed it'],
        acceptableAlternativeAnswers: [],
        partialAnswers: [],
        distractors: ['cancelled it'],
        correctiveExplanation: 'Postponed means moved to a later time.',
      },
      provenance: {
        approvedAt: '2026-08-15T11:05:00.000Z',
        generation: { model: 'controlled', promptVersion: 'review-v1' },
        validatorVersion: 'validator-v1',
        evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
        relevantEvidence: [
          ...BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings,
        ],
        licenseAndAttribution:
          BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution,
        validation: { outcome: 'approved', reasons: [] },
      },
    };
    await worker.evaluate(
      async ({ approvedKey, schedulesKey, item }) => {
        await chrome.storage.local.set({
          [approvedKey]: { version: 1, records: [item] },
          [schedulesKey]: {
            version: 1,
            records: [
              {
                version: 1,
                learningItemId: item.learningItemId,
                knowledgeDimension: item.knowledgeDimension,
                dueAt: '2020-01-01T00:00:00.000Z',
                demonstratedCount: 0,
                intervalStage: 0,
              },
            ],
          },
        });
      },
      {
        approvedKey: APPROVED_REVIEW_ITEMS_STORAGE_KEY,
        schedulesKey: REVIEW_SCHEDULES_STORAGE_KEY,
        item: reviewItem,
      },
    );

    await sidePanel.getByRole('tab', { name: 'Review' }).click();
    await expect
      .poll(() => sidePanel.getByRole('button', { name: '開始 Review' }).isVisible())
      .toBe(true);
    await sidePanel.getByRole('button', { name: '開始 Review' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('<img src=x onerror=alert(1)> Which meaning fits?', {
            exact: true,
          })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel.evaluate(() => document.activeElement?.id),
      )
      .toBe('review-response');
    expect(
      await sidePanel
        .getByText('<svg onload=alert(2)> delayed it', { exact: true })
        .count(),
    ).toBe(0);
    expect(await sidePanel.locator('img, svg').count()).toBe(0);
    await expect
      .poll(() => sidePanel.getByText('shortened session').isVisible())
      .toBe(true);

    await sidePanel.close();
    await context.close();
    context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      offline: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await sidePanel.getByRole('tab', { name: 'Review' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('<img src=x onerror=alert(1)> Which meaning fits?', {
            exact: true,
          })
          .isVisible(),
      )
      .toBe(true);
    expect(
      await sidePanel
        .getByText('<svg onload=alert(2)> delayed it', { exact: true })
        .count(),
    ).toBe(0);
    await sidePanel.getByRole('textbox', { name: '你的答案' }).fill(
      '<svg onload=alert(2)> delayed it',
    );
    await sidePanel
      .getByRole('button', { name: '很流暢地想起來' })
      .click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('<svg onload=alert(2)> delayed it', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel.getByText('Review Judgment: 已展現', { exact: true }).isVisible(),
      )
      .toBe(true);
    expect(await sidePanel.locator('img, svg').count()).toBe(0);
    await expect
      .poll(() =>
        sidePanel.evaluate(() => document.activeElement?.textContent?.trim()),
      )
      .toBe('完成 Review');
    await sidePanel.getByRole('button', { name: '完成 Review' }).click();
    await expect
      .poll(() => sidePanel.getByText('本次 Review 已完成').isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel.evaluate(() => document.activeElement?.textContent?.trim()),
      )
      .toBe('返回 Review');

    const storedReview = await worker.evaluate(
      async ([sessionsKey, schedulesKey, evidenceKey]) =>
        chrome.storage.local.get([sessionsKey, schedulesKey, evidenceKey]),
      [
        REVIEW_SESSIONS_STORAGE_KEY,
        REVIEW_SCHEDULES_STORAGE_KEY,
        REVIEW_EVIDENCE_STORAGE_KEY,
      ] as const,
    );
    expect(storedReview[REVIEW_SESSIONS_STORAGE_KEY]).toMatchObject({
      version: 1,
      records: [
        {
          status: 'completed',
          reviewItemIds: ['approved-review-postponed'],
          revealedReviewItemIds: ['approved-review-postponed'],
        },
      ],
    });
    expect(storedReview[REVIEW_SCHEDULES_STORAGE_KEY]).toMatchObject({
      version: 1,
      records: [
        {
          learningItemId,
          knowledgeDimension: 'contextual-meaning',
          intervalStage: 1,
          demonstratedCount: 1,
        },
      ],
    });
    expect(storedReview[REVIEW_EVIDENCE_STORAGE_KEY]).toMatchObject({
      version: 1,
      records: [
        {
          version: 1,
          learningItemId,
          reviewItemId: 'approved-review-postponed',
          kind: 'objective',
          responseMethod: 'overt-response',
          retrievalFluency: 'recalled-fluently',
          responseText: '<svg onload=alert(2)> delayed it',
          judgment: 'demonstrated',
          scheduleTransition: {
            previous: {
              intervalStage: 0,
              demonstratedCount: 0,
            },
            next: {
              intervalStage: 1,
              demonstratedCount: 1,
            },
          },
        },
      ],
    });
    await sidePanel.getByRole('button', { name: '返回 Review' }).click();
    await sidePanel.getByText('Review Evidence（1）', { exact: true }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Schedule transition: stage 0 → 1', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByText('Demonstrated count: 0 → 1', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByText('Overt response: <svg onload=alert(2)> delayed it', {
            exact: true,
          })
          .isVisible(),
      )
      .toBe(true);
    expect(await sidePanel.locator('img, svg').count()).toBe(0);

    await worker.evaluate(
      async ({ learningKey, approvedKey, schedulesKey, sessionsKey, template }) => {
        const learningItems = [
          ['learning-z', '2026-08-10T00:00:00.000Z'],
          ['learning-y', '2026-08-10T00:00:00.000Z'],
          ['learning-x', '2026-08-10T00:00:00.000Z'],
          ['learning-w', '2026-08-09T00:00:00.000Z'],
          ['learning-a', '2026-08-10T00:00:00.000Z'],
          ['learning-b', '2026-08-10T00:00:00.000Z'],
          ['learning-future', '2026-08-01T00:00:00.000Z'],
        ].map(([id, createdAt]) => ({
          version: 1,
          id,
          expression: id,
          normalizedExpression: id,
          sensePin: null,
          productiveUseIntent: false,
          createdAt,
          status: 'active',
        }));
        const approvalSpecs = [
          ['review-a', 'learning-z'],
          ['review-b', 'learning-y'],
          ['review-c1', 'learning-x'],
          ['review-c0', 'learning-x'],
          ['review-d', 'learning-w'],
          ['review-e', 'learning-a'],
          ['review-f', 'learning-b'],
          ['review-future', 'learning-future'],
        ];
        const approvedItems = approvalSpecs.map(([id, itemId]) => ({
          ...template,
          id,
          learningItemId: itemId,
          task: {
            ...template.task,
            prompt: `Retrieve ${id}`,
            contextQuote: `Context for ${id}`,
          },
        }));
        const scheduleSpecs = [
          ['learning-z', '2026-08-10T00:00:00.000Z', 9, 8],
          ['learning-y', '2026-08-11T00:00:00.000Z', 0, 7],
          ['learning-x', '2026-08-11T00:00:00.000Z', 1, 0],
          ['learning-w', '2026-08-11T00:00:00.000Z', 1, 1],
          ['learning-a', '2026-08-11T00:00:00.000Z', 1, 1],
          ['learning-b', '2026-08-11T00:00:00.000Z', 1, 1],
          ['learning-future', '2099-08-16T00:00:00.000Z', 0, 0],
        ];
        const schedules = scheduleSpecs.map(
          ([itemId, dueAt, demonstratedCount, intervalStage]) => ({
            version: 1,
            learningItemId: itemId,
            knowledgeDimension: 'contextual-meaning',
            dueAt,
            demonstratedCount,
            intervalStage,
          }),
        );
        await chrome.storage.local.set({
          [learningKey]: {
            version: 1,
            learningItems,
            encounters: [],
            mergeSuggestions: [],
            history: [],
          },
          [approvedKey]: { version: 1, records: approvedItems },
          [schedulesKey]: { version: 1, records: schedules },
          [sessionsKey]: { version: 1, records: [] },
        });
      },
      {
        learningKey: LEARNING_STATE_STORAGE_KEY,
        approvedKey: APPROVED_REVIEW_ITEMS_STORAGE_KEY,
        schedulesKey: REVIEW_SCHEDULES_STORAGE_KEY,
        sessionsKey: REVIEW_SESSIONS_STORAGE_KEY,
        template: reviewItem,
      },
    );
    await sidePanel.reload();
    await sidePanel.getByRole('tab', { name: 'Review' }).click();
    await expect
      .poll(() => sidePanel.getByRole('button', { name: '開始 Review' }).isVisible())
      .toBe(true);
    await sidePanel.getByRole('button', { name: '開始 Review' }).click();
    await expect
      .poll(() => sidePanel.getByText('Retrieve review-a', { exact: true }).isVisible())
      .toBe(true);
    const fullSessionState = await worker.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key],
      REVIEW_SESSIONS_STORAGE_KEY,
    );
    expect(fullSessionState).toMatchObject({
      version: 1,
      records: [
        {
          status: 'active',
          reviewItemIds: [
            'review-a',
            'review-b',
            'review-c0',
            'review-d',
            'review-e',
          ],
        },
      ],
    });
  }, 60_000);

  it('reviews usage fit and grammar pattern independently across an offline restart', async () => {
    const usageEvidence = BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0];
    const grammarEvidence = BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns[0];
    if (usageEvidence === undefined || grammarEvidence === undefined) {
      throw new Error('Expected bundled usage-fit and grammar-pattern evidence.');
    }
    const approvedItems: ApprovedReviewItem[] = [
      {
        version: 1,
        id: 'review-usage-fit',
        learningItemId: 'learning-usage-fit',
        knowledgeDimension: 'usage-fit',
        task: {
          type: 'contrastive',
          prompt: 'Does postpone fit this context?',
          contextQuote: "let's postpone the exam",
          targetAnswers: ['fits'],
          acceptableAlternativeAnswers: ['works here'],
          partialAnswers: ['probably'],
          distractors: ['does not fit'],
          correctiveExplanation:
            'Postpone fits because the exam was moved to a later time.',
        },
        provenance: {
          approvedAt: '2026-08-15T10:00:00.000Z',
          generation: { model: 'controlled', promptVersion: 'usage-fit-v1' },
          validatorVersion: 'usage-fit-validator-v1',
          evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
          relevantEvidence: [usageEvidence],
          sourceAuthority: {
            knowledgeDimension: 'usage-fit',
            evidence: [
              {
                evidenceId: usageEvidence.id,
                sourceId: usageEvidence.sourceId,
                sourceVersion: usageEvidence.sourceVersion,
                authority: usageEvidence.authority,
              },
            ],
          },
          licenseAndAttribution:
            BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution,
          validation: { outcome: 'approved', reasons: [] },
        },
      },
      {
        version: 1,
        id: 'review-grammar-pattern',
        learningItemId: 'learning-grammar-pattern',
        knowledgeDimension: 'grammar-pattern',
        task: {
          type: 'recall',
          prompt: 'What grammatical pattern does postponed use here?',
          contextQuote: 'They postponed the vote until next week.',
          targetAnswers: ['Somebody postpones something'],
          acceptableAlternativeAnswers: ['They postpone the vote'],
          partialAnswers: ['transitive verb'],
          correctiveExplanation:
            'Postpone is transitive here: somebody postpones something.',
        },
        provenance: {
          approvedAt: '2026-08-15T10:01:00.000Z',
          generation: {
            model: 'controlled',
            promptVersion: 'grammar-pattern-v1',
          },
          validatorVersion: 'grammar-pattern-validator-v1',
          evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
          relevantEvidence: [grammarEvidence],
          sourceAuthority: {
            knowledgeDimension: 'grammar-pattern',
            evidence: [
              {
                evidenceId: grammarEvidence.id,
                sourceId: grammarEvidence.sourceId,
                sourceVersion: grammarEvidence.sourceVersion,
                authority: grammarEvidence.authority,
              },
            ],
          },
          licenseAndAttribution:
            BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution,
          validation: { outcome: 'approved', reasons: [] },
        },
      },
    ];

    await worker.evaluate(
      async ({
        learningKey,
        approvedKey,
        schedulesKey,
        sessionsKey,
        markersKey,
        reviewEvidenceKey,
        approved,
      }) => {
        await chrome.storage.local.remove([
          sessionsKey,
          markersKey,
          reviewEvidenceKey,
        ]);
        await chrome.storage.local.set({
          [learningKey]: {
            version: 1,
            learningItems: [
              {
                version: 1,
                id: 'learning-usage-fit',
                expression: 'postpone',
                normalizedExpression: 'postpone',
                sensePin: null,
                productiveUseIntent: false,
                createdAt: '2026-08-01T00:00:00.000Z',
                status: 'active',
              },
              {
                version: 1,
                id: 'learning-grammar-pattern',
                expression: 'postponed',
                normalizedExpression: 'postponed',
                sensePin: null,
                productiveUseIntent: false,
                createdAt: '2026-08-02T00:00:00.000Z',
                status: 'active',
              },
            ],
            encounters: [],
            mergeSuggestions: [],
            history: [],
          },
          [approvedKey]: { version: 1, records: approved },
          [schedulesKey]: {
            version: 1,
            records: [
              {
                version: 1,
                learningItemId: 'learning-usage-fit',
                knowledgeDimension: 'usage-fit',
                dueAt: '2026-08-01T00:00:00.000Z',
                demonstratedCount: 0,
                intervalStage: 0,
              },
              {
                version: 1,
                learningItemId: 'learning-grammar-pattern',
                knowledgeDimension: 'grammar-pattern',
                dueAt: '2026-08-02T00:00:00.000Z',
                demonstratedCount: 0,
                intervalStage: 0,
              },
            ],
          },
        });
      },
      {
        learningKey: LEARNING_STATE_STORAGE_KEY,
        approvedKey: APPROVED_REVIEW_ITEMS_STORAGE_KEY,
        schedulesKey: REVIEW_SCHEDULES_STORAGE_KEY,
        sessionsKey: REVIEW_SESSIONS_STORAGE_KEY,
        markersKey: REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
        reviewEvidenceKey: REVIEW_EVIDENCE_STORAGE_KEY,
        approved: approvedItems,
      },
    );

    let sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await sidePanel.getByRole('tab', { name: 'Review' }).click();
    await sidePanel.getByRole('button', { name: '開始 Review' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Knowledge dimension: 語境用法適切性', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await sidePanel
      .getByRole('textbox', { name: '你的答案' })
      .fill('works here');
    await sidePanel
      .getByRole('button', { name: '很流暢地想起來' })
      .click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Review Judgment: 可接受的替代答案', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await sidePanel.getByRole('button', { name: '下一題' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Knowledge dimension: 文法模式', { exact: true })
          .isVisible(),
      )
      .toBe(true);

    await sidePanel.close();
    await context.close();
    context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      offline: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    sidePanel = await context.newPage();
    await sidePanel.goto(`${extensionOriginFrom(worker)}/sidepanel.html`);
    await sidePanel.getByRole('tab', { name: 'Review' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Knowledge dimension: 文法模式', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await sidePanel
      .getByRole('textbox', { name: '你的答案' })
      .fill('Somebody postpones something');
    await sidePanel
      .getByRole('button', { name: '想起來但有點費力' })
      .click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Review Judgment: 已展現', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await sidePanel.getByRole('button', { name: '完成 Review' }).click();
    await expect
      .poll(() => sidePanel.getByText('本次 Review 已完成').isVisible())
      .toBe(true);

    const storedReview = await worker.evaluate(
      async ([schedulesKey, evidenceKey]) =>
        chrome.storage.local.get([schedulesKey, evidenceKey]),
      [REVIEW_SCHEDULES_STORAGE_KEY, REVIEW_EVIDENCE_STORAGE_KEY] as const,
    );
    expect(storedReview[REVIEW_SCHEDULES_STORAGE_KEY]).toMatchObject({
      version: 1,
      records: expect.arrayContaining([
        expect.objectContaining({
          learningItemId: 'learning-usage-fit',
          knowledgeDimension: 'usage-fit',
          intervalStage: 0,
        }),
        expect.objectContaining({
          learningItemId: 'learning-grammar-pattern',
          knowledgeDimension: 'grammar-pattern',
          intervalStage: 1,
          demonstratedCount: 1,
        }),
      ]),
    });
    expect(storedReview[REVIEW_EVIDENCE_STORAGE_KEY]).toMatchObject({
      version: 1,
      records: [
        expect.objectContaining({
          version: 2,
          reviewItemId: 'review-usage-fit',
          knowledgeDimension: 'usage-fit',
          judgment: 'acceptable-alternative',
          sourceAuthority: {
            knowledgeDimension: 'usage-fit',
            evidence: [
              expect.objectContaining({
                evidenceId: usageEvidence.id,
                authority: usageEvidence.authority,
              }),
            ],
          },
        }),
        expect.objectContaining({
          version: 2,
          reviewItemId: 'review-grammar-pattern',
          knowledgeDimension: 'grammar-pattern',
          judgment: 'demonstrated',
          sourceAuthority: {
            knowledgeDimension: 'grammar-pattern',
            evidence: [
              expect.objectContaining({
                evidenceId: grammarEvidence.id,
                authority: grammarEvidence.authority,
              }),
            ],
          },
        }),
      ],
    });
    await sidePanel.getByRole('button', { name: '返回 Review' }).click();
    await sidePanel.getByText('Review Evidence（2）', { exact: true }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText(
            `Source authority: ${usageEvidence.sourceId} ${usageEvidence.sourceVersion} · ${usageEvidence.authority} · ${usageEvidence.id}`,
            { exact: true },
          )
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByText(
            `Source authority: ${grammarEvidence.sourceId} ${grammarEvidence.sourceVersion} · ${grammarEvidence.authority} · ${grammarEvidence.id}`,
            { exact: true },
          )
          .isVisible(),
      )
      .toBe(true);
  }, 60_000);
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
