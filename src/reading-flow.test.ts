import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import type { BrowserContext, Frame, Locator, Page, Worker } from 'playwright-core';
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
import { REVIEW_PREPARATION_JOBS_STORAGE_KEY } from './modules/review/review-preparation-queue';
import {
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_EVIDENCE_STORAGE_KEY,
  REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
  REVIEW_SCHEDULES_STORAGE_KEY,
  REVIEW_SESSIONS_STORAGE_KEY,
} from './modules/review/review-storage-keys';
import { LEARNER_NOTES_STORAGE_KEY } from './modules/learning/learner-note';
import {
  IMPORT_REPORTS_STORAGE_KEY,
  IMPORT_STAGING_STORAGE_KEY,
  PORTABLE_PREFERENCES_STORAGE_KEY,
  PORTABLE_RECORD_PROVENANCE_STORAGE_KEY,
} from './modules/portability/portable-backup';
import {
  SMOKE_ANNOUNCEMENT_STATES,
  SMOKE_EXCLUDED_SURFACE_KINDS,
  SMOKE_FLOW_NAMES,
  summarizeSmokeLatencyValues,
} from './modules/smoke/smoke-evidence';
import {
  SUPPORTED_PAGE_SMOKE_PLAN,
  type SupportedPageSmokeCase,
} from './modules/smoke/supported-page-smoke-plan';

declare const chrome: typeof browser;

const executeFile = promisify(execFile);

const extensionPath = resolve('.output/chrome-mv3');
type SmokeFlowName = (typeof SMOKE_FLOW_NAMES)[number];
type SmokeAnnouncementState = (typeof SMOKE_ANNOUNCEMENT_STATES)[number];
type SmokeExcludedSurfaceKind =
  (typeof SMOKE_EXCLUDED_SURFACE_KINDS)[number];
type SupportedPageRun = {
  pageCase: SupportedPageSmokeCase;
  milliseconds: number;
};

const observedSmokeFlows = new Map<SmokeFlowName, string>();
const observedAnnouncementStates = new Map<SmokeAnnouncementState, string>();
const observedExcludedSurfaces = new Map<SmokeExcludedSurfaceKind, string>();
let completedSupportedPageRuns: readonly SupportedPageRun[] = [];
let completedSmokeLatencyGroups: readonly SmokeLatencyGroup[] = [];

let context: BrowserContext;
let page: Page;
let worker: Worker;
let origin: string;
let profilePath: string;
let closeServer: () => Promise<void>;
let serverPort: number;

beforeAll(async () => {
  const server = createServer((request, response) => {
    if (request.url === '/excluded.pdf') {
      response.setHeader('Content-Type', 'application/pdf');
      response.end(minimalPdf());
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const smokeFixture = renderSmokeFixture(request.url, request.headers.host);
    if (smokeFixture !== null) {
      response.end(smokeFixture);
      return;
    }
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
  serverPort = address.port;
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
    ...smokeMatchPatterns(),
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
      '--host-resolver-rules=MAP *.lingo.test 127.0.0.1',
    ],
  });
  
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  await worker.evaluate(
    async ([
      siteOrigin,
      smokePatterns,
      scriptId,
      configurationKey,
      apiKeyKey,
      defaultConfiguration,
    ]) => {
      await chrome.scripting.registerContentScripts([
        {
          id: scriptId,
          js: ['/reading-flow.js'],
          matches: [`${siteOrigin}/*`, ...smokePatterns],
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
      smokeMatchPatterns(),
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
    await activateByKeyboard(quickHintButton);
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
    observedSmokeFlows.set(
      'quick-hint',
      'Quick Hint completed from an Enter key activation and retained visible focus.',
    );
    observedAnnouncementStates.set(
      'result-count',
      'Quick Hint announced completion with an explicit total token count.',
    );
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
    await activateByKeyboard(
      pronunciation.getByRole('button', { name: 'US English' }),
    );
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toContain('第 1 次語音嘗試未完成');
    await activateByKeyboard(
      pronunciation.getByRole('button', { name: '暫停' }),
    );
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toContain('已暫停');
    await activateByKeyboard(
      pronunciation.getByRole('button', { name: '繼續' }),
    );
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
    await activateByKeyboard(
      pronunciation.getByRole('button', { name: 'US English' }),
    );
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
    await activateByKeyboard(
      pronunciation.getByRole('button', { name: 'UK English' }),
    );
    await expect
      .poll(() => pronunciationStatus.textContent())
      .toContain('正在產生 AI 語音');
    await activateByKeyboard(
      pronunciation.getByRole('button', { name: '停止' }),
    );
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
    observedSmokeFlows.set(
      'pronunciation',
      'Pronunciation playback, pause, resume, offline cache, and stop completed from keyboard activations with visible focus.',
    );
    observedAnnouncementStates.set(
      'playback',
      'Playback progress, pause, resume, cache, and stop states were announced in place.',
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
    await activateByKeyboard(
      page.getByRole('button', { name: 'Deep Dive' }),
    );
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
    observedSmokeFlows.set(
      'deep-dive-current',
      'Deep Dive entered stable Side Panel Current from an Enter key activation and preserved keyboard tab navigation.',
    );
    observedAnnouncementStates.set(
      'working',
      'Deep Dive rendered and announced its in-progress state without moving page focus.',
    );
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
    expect(shortcut).toBe(
      process.platform === 'darwin' ? 'Command+Shift+L' : 'Ctrl+Shift+Y',
    );
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
    observedAnnouncementStates.set(
      'budget',
      'Budget validation and saved-limit status messages were announced in place.',
    );
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
    observedAnnouncementStates.set(
      'offline',
      'The offline cache miss was announced in the anchored status region.',
    );
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
    observedAnnouncementStates.set(
      'retry',
      'Retry waiting, exhaustion, and subsequent success were announced in place.',
    );
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
    observedAnnouncementStates.set(
      'error',
      'Every terminal provider and local budget error was announced while Selection remained intact.',
    );
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
    await activateByKeyboard(settings.locator('#inspect-evidence-pack'));
    await expect
      .poll(() => settings.locator('#evidence-pack-status').textContent())
      .toContain('候選版本只存於 staging');
    await activateByKeyboard(settings.locator('#confirm-evidence-pack'));
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
    await activateByKeyboard(
      restartedSettings.locator('#rollback-evidence-pack-button'),
    );
    await expect
      .poll(() =>
        restartedSettings.locator('#active-evidence-pack').textContent(),
      )
      .toBe(BUNDLED_EVIDENCE_PACK_VERSION);
    await restartedSettings.close();

    await context.setOffline(false);
    page = await context.newPage();
    await page.goto(origin);
    observedSmokeFlows.set(
      'evidence-pack-status',
      'Evidence Pack inspect, activate, recovery, and rollback completed from keyboard activations with visible focus.',
    );
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
    await activateByKeyboard(sidePanel.getByRole('tab', { name: 'Recent' }));
    await expect
      .poll(() => sidePanel.getByText('offline Recent lookup').isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel.getByText('<img src=x onerror=alert(1)>').isVisible(),
      )
      .toBe(true);
    expect(await sidePanel.locator('img').count()).toBe(0);
    await activateByKeyboard(sidePanel.getByRole('tab', { name: 'Saved' }));
    await expect
      .poll(() =>
        sidePanel.getByText('目前沒有已儲存的 Learning Items。').isVisible(),
      )
      .toBe(true);
    observedSmokeFlows.set(
      'recent',
      'Recent opened from an Enter key activation and exposed the recovered Lookup as text.',
    );
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
    observedSmokeFlows.set(
      'saved',
      'Saved learning items, classifications, merge choices, undo, and recovery remained keyboard-operable with textual states.',
    );
    observedAnnouncementStates.set(
      'saved',
      'Saved and merge outcomes were exposed as persistent textual status rather than color alone.',
    );
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

    await activateByKeyboard(sidePanel.getByRole('tab', { name: 'Review' }));
    await expect
      .poll(() => sidePanel.getByRole('button', { name: '開始 Review' }).isVisible())
      .toBe(true);
    await activateByKeyboard(
      sidePanel.getByRole('button', { name: '開始 Review' }),
    );
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
    await activateByKeyboard(
      sidePanel.getByRole('button', { name: '很流暢地想起來' }),
    );
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
    await activateByKeyboard(
      sidePanel.getByRole('button', { name: '完成 Review' }),
    );
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
    observedSmokeFlows.set(
      'review-session',
      'A complete Review Session was entered and answered from keyboard activations with visible focus and textual evidence.',
    );
  }, 60_000);

  it('reviews receptive and productive dimensions across an offline restart with opt-in scheduling', async () => {
    const usageEvidence = BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0];
    const grammarEvidence = BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns[0];
    const collocationEvidence = BUNDLED_ENGLISH_EVIDENCE_PACK.collocations[0];
    const productiveEvidence =
      BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0];
    if (
      usageEvidence === undefined ||
      grammarEvidence === undefined ||
      collocationEvidence === undefined ||
      productiveEvidence === undefined
    ) {
      throw new Error('Expected bundled evidence for the mixed Review Session.');
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
      {
        version: 1,
        id: 'review-collocation',
        learningItemId: 'learning-collocation',
        knowledgeDimension: 'collocation',
        task: {
          type: 'recall',
          prompt: 'Which verb commonly combines with decision?',
          contextQuote: 'We must make a decision quickly.',
          targetAnswers: ['make a decision'],
          acceptableAlternativeAnswers: [],
          partialAnswers: ['make'],
          correctiveExplanation:
            'The corpus records make and decision in the same sentence.',
        },
        provenance: {
          approvedAt: '2026-08-15T10:02:00.000Z',
          generation: { model: 'controlled', promptVersion: 'collocation-v1' },
          validatorVersion: 'collocation-validator-v1',
          evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
          relevantEvidence: [collocationEvidence],
          sourceAuthority: {
            knowledgeDimension: 'collocation',
            evidence: [
              {
                evidenceId: collocationEvidence.id,
                sourceId: collocationEvidence.sourceId,
                sourceVersion: collocationEvidence.sourceVersion,
                authority: collocationEvidence.authority,
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
        id: 'review-productive-use',
        learningItemId: 'learning-productive-use',
        knowledgeDimension: 'productive-use',
        task: {
          type: 'productive',
          prompt: 'Write a sentence that uses postpone naturally.',
          contextQuote: "let's postpone the exam",
          targetAnswers: ['We postponed the meeting until Friday.'],
          acceptableAlternativeAnswers: ['They postponed their trip.'],
          partialAnswers: ['We moved it.'],
          correctiveExplanation:
            'Use postpone for moving an event to a later time.',
        },
        provenance: {
          approvedAt: '2026-08-15T10:03:00.000Z',
          generation: {
            model: 'controlled',
            promptVersion: 'productive-use-v1',
          },
          validatorVersion: 'productive-use-validator-v1',
          evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
          relevantEvidence: [productiveEvidence],
          sourceAuthority: {
            knowledgeDimension: 'productive-use',
            evidence: [
              {
                evidenceId: productiveEvidence.id,
                sourceId: productiveEvidence.sourceId,
                sourceVersion: productiveEvidence.sourceVersion,
                authority: productiveEvidence.authority,
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
              {
                version: 1,
                id: 'learning-collocation',
                expression: 'decision',
                normalizedExpression: 'decision',
                sensePin: null,
                productiveUseIntent: false,
                createdAt: '2026-08-03T00:00:00.000Z',
                status: 'active',
              },
              {
                version: 1,
                id: 'learning-productive-use',
                expression: 'postpone actively',
                normalizedExpression: 'postpone actively',
                sensePin: null,
                productiveUseIntent: false,
                createdAt: '2026-08-04T00:00:00.000Z',
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
              {
                version: 1,
                learningItemId: 'learning-collocation',
                knowledgeDimension: 'collocation',
                dueAt: '2026-08-03T00:00:00.000Z',
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
    await sidePanel.getByRole('tab', { name: 'Saved' }).click();
    const productiveLearningItem = sidePanel
      .locator('.learning-item')
      .filter({ hasText: 'postpone actively' });
    const productiveIntent = productiveLearningItem.getByRole('checkbox', {
      name: 'Productive-use Intent',
    });
    await productiveIntent.check();
    await expect.poll(() => productiveIntent.isChecked()).toBe(true);
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
    await sidePanel.getByRole('button', { name: '下一題' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Knowledge dimension: 搭配詞', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await sidePanel
      .getByRole('textbox', { name: '你的答案' })
      .fill('make a decision');
    await sidePanel
      .getByRole('button', { name: '很流暢地想起來' })
      .click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Review Judgment: 已展現', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await sidePanel.screenshot({
      path: resolve('docs/assets/issue-14-collocation-review.png'),
      fullPage: true,
    });
    await sidePanel.getByRole('button', { name: '下一題' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Knowledge dimension: 主動產出', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByText('Review mode: 主動產出（客觀評分）', { exact: true })
          .isVisible(),
      )
      .toBe(true);
    await sidePanel.screenshot({
      path: resolve('docs/assets/issue-14-productive-review.png'),
      fullPage: true,
    });
    await sidePanel
      .getByRole('textbox', { name: '你的答案' })
      .fill('They postponed their trip.');
    await sidePanel
      .getByRole('button', { name: '想起來但有點費力' })
      .click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('Review Judgment: 可接受的替代答案', { exact: true })
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
        expect.objectContaining({
          learningItemId: 'learning-collocation',
          knowledgeDimension: 'collocation',
          intervalStage: 1,
          demonstratedCount: 1,
        }),
        expect.objectContaining({
          learningItemId: 'learning-productive-use',
          knowledgeDimension: 'productive-use',
          intervalStage: 0,
          demonstratedCount: 0,
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
        expect.objectContaining({
          version: 2,
          reviewItemId: 'review-collocation',
          knowledgeDimension: 'collocation',
          responseMethod: 'overt-response',
          judgment: 'demonstrated',
          sourceAuthority: {
            knowledgeDimension: 'collocation',
            evidence: [
              expect.objectContaining({
                evidenceId: collocationEvidence.id,
                authority: collocationEvidence.authority,
              }),
            ],
          },
        }),
        expect.objectContaining({
          version: 2,
          reviewItemId: 'review-productive-use',
          knowledgeDimension: 'productive-use',
          responseMethod: 'overt-production',
          retrievalFluency: 'recalled-with-effort',
          judgment: 'acceptable-alternative',
          sourceAuthority: {
            knowledgeDimension: 'productive-use',
            evidence: [
              expect.objectContaining({
                evidenceId: productiveEvidence.id,
                authority: productiveEvidence.authority,
              }),
            ],
          },
        }),
      ],
    });
    await sidePanel.getByRole('button', { name: '返回 Review' }).click();
    await sidePanel.getByText('Review Evidence（4）', { exact: true }).click();
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
    await expect
      .poll(() =>
        sidePanel
          .getByText(
            `Source authority: ${collocationEvidence.sourceId} ${collocationEvidence.sourceVersion} · ${collocationEvidence.authority} · ${collocationEvidence.id}`,
            { exact: true },
          )
          .isVisible(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        sidePanel
          .getByText(
            `Source authority: ${productiveEvidence.sourceId} ${productiveEvidence.sourceVersion} · ${productiveEvidence.authority} · ${productiveEvidence.id}`,
            { exact: true },
          )
          .isVisible(),
      )
      .toBe(true);
    await sidePanel.screenshot({
      path: resolve('docs/assets/issue-14-source-authority.png'),
      fullPage: true,
    });
    const beforeIntentPause = await worker.evaluate(
      async ([learningKey, schedulesKey, evidenceKey]) =>
        chrome.storage.local.get([learningKey, schedulesKey, evidenceKey]),
      [
        LEARNING_STATE_STORAGE_KEY,
        REVIEW_SCHEDULES_STORAGE_KEY,
        REVIEW_EVIDENCE_STORAGE_KEY,
      ] as const,
    );
    await sidePanel.getByRole('tab', { name: 'Saved' }).click();
    const resumedProductiveIntent = sidePanel
      .locator('.learning-item')
      .filter({ hasText: 'postpone actively' })
      .getByRole('checkbox', { name: 'Productive-use Intent' });
    await resumedProductiveIntent.uncheck();
    await expect.poll(() => resumedProductiveIntent.isChecked()).toBe(false);
    await sidePanel.screenshot({
      path: resolve('docs/assets/issue-14-productive-paused.png'),
      fullPage: true,
    });
    const pausedState = await worker.evaluate(
      async ([learningKey, schedulesKey, evidenceKey]) =>
        chrome.storage.local.get([learningKey, schedulesKey, evidenceKey]),
      [
        LEARNING_STATE_STORAGE_KEY,
        REVIEW_SCHEDULES_STORAGE_KEY,
        REVIEW_EVIDENCE_STORAGE_KEY,
      ] as const,
    );
    expect(
      (
        pausedState[LEARNING_STATE_STORAGE_KEY] as {
          learningItems: Array<{
            id: string;
            productiveUseIntent: boolean;
          }>;
        }
      ).learningItems.find(({ id }) => id === 'learning-productive-use')
        ?.productiveUseIntent,
    ).toBe(false);
    expect(pausedState[REVIEW_SCHEDULES_STORAGE_KEY]).toEqual(
      beforeIntentPause[REVIEW_SCHEDULES_STORAGE_KEY],
    );
    expect(pausedState[REVIEW_EVIDENCE_STORAGE_KEY]).toEqual(
      beforeIntentPause[REVIEW_EVIDENCE_STORAGE_KEY],
    );
    await resumedProductiveIntent.check();
    await expect.poll(() => resumedProductiveIntent.isChecked()).toBe(true);
    const resumedState = await worker.evaluate(
      async ([schedulesKey, evidenceKey]) =>
        chrome.storage.local.get([schedulesKey, evidenceKey]),
      [REVIEW_SCHEDULES_STORAGE_KEY, REVIEW_EVIDENCE_STORAGE_KEY] as const,
    );
    expect(resumedState[REVIEW_SCHEDULES_STORAGE_KEY]).toEqual(
      beforeIntentPause[REVIEW_SCHEDULES_STORAGE_KEY],
    );
    expect(resumedState[REVIEW_EVIDENCE_STORAGE_KEY]).toEqual(
      beforeIntentPause[REVIEW_EVIDENCE_STORAGE_KEY],
    );
  }, 60_000);

  it('recovers independently approved multi-dimension Review Items after an offline worker restart', async () => {
    const evidence =
      BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0];
    const usageEvidence = BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0];
    if (evidence === undefined || usageEvidence === undefined) {
      throw new Error('Expected bundled contextual and usage-fit evidence.');
    }
    const completed = (output: unknown) => ({
      status: 200,
      body: {
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(output),
              },
            ],
          },
        ],
        usage: {
          input_tokens: 600,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 300,
          output_tokens_details: { reasoning_tokens: 100 },
          total_tokens: 900,
        },
      },
    });
    const restartExtension = async () => {
      await context.close();
      context = await chromium.launchPersistentContext(profilePath!, {
        headless: false,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--enable-caret-browsing',
          '--host-resolver-rules=MAP *.lingo.test 127.0.0.1',
        ],
      });
      worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent('serviceworker'));
      page = await context.newPage();
    };
    await worker.evaluate(
      async ({
        learningKey,
        approvedKey,
        schedulesKey,
        sessionsKey,
        evidenceKey,
        markersKey,
        jobsKey,
        budgetSettingsKey,
        budgetLedgerKey,
        configurationKey,
        apiKeyKey,
        evidencePackStateKey,
        configuration,
        sourceSenseId,
        responses,
      }) => {
        await chrome.storage.local.remove([
          approvedKey,
          schedulesKey,
          sessionsKey,
          evidenceKey,
          markersKey,
          jobsKey,
          budgetLedgerKey,
          evidencePackStateKey,
        ]);
        await chrome.storage.local.set({
          [configurationKey]: configuration,
          [apiKeyKey]: 'sk-review-background-test',
          [budgetSettingsKey]: {
            tokenLimit: 100_000,
            estimatedCostUsdLimit: 1,
          },
          [learningKey]: {
            version: 1,
            learningItems: [
              {
                version: 1,
                id: 'learning-background',
                expression: 'postpone',
                normalizedExpression: 'postpone',
                sensePin: {
                  evidencePackVersion: '2025.1.0-minimal.3',
                  sourceSenseId,
                  morphology: 'base-form:postpone',
                  partOfSpeech: 'verb',
                },
                productiveUseIntent: false,
                createdAt: '2026-08-01T00:00:00.000Z',
                status: 'active',
              },
            ],
            encounters: [
              {
                version: 1,
                id: 'encounter-background',
                learningItemId: 'learning-background',
                lookupRecordId: 'lookup-background',
                selection: {
                  text: 'postpone',
                  context: {
                    before: "Let's ",
                    after: ' the exam',
                  },
                },
                action: {
                  type: 'quick-hint',
                  result: {
                    simplerExpression: 'delay until later',
                    explanationCue: null,
                  },
                },
                completedAt: '2026-08-01T00:00:00.000Z',
                savedAt: '2026-08-01T00:01:00.000Z',
                sensePin: {
                  evidencePackVersion: '2025.1.0-minimal.3',
                  sourceSenseId,
                  morphology: 'base-form:postpone',
                  partOfSpeech: 'verb',
                },
              },
            ],
            mergeSuggestions: [],
            history: [],
          },
          [schedulesKey]: {
            version: 1,
            records: [
              {
                version: 1,
                learningItemId: 'learning-background',
                knowledgeDimension: 'contextual-meaning',
                dueAt: '2026-08-01T00:00:00.000Z',
                demonstratedCount: 2,
                intervalStage: 3,
              },
            ],
          },
          openAiTestOnline: true,
          openAiTestRequests: [],
          openAiTestResponses: responses,
        });
      },
      {
        learningKey: LEARNING_STATE_STORAGE_KEY,
        approvedKey: APPROVED_REVIEW_ITEMS_STORAGE_KEY,
        schedulesKey: REVIEW_SCHEDULES_STORAGE_KEY,
        sessionsKey: REVIEW_SESSIONS_STORAGE_KEY,
        evidenceKey: REVIEW_EVIDENCE_STORAGE_KEY,
        markersKey: REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
        jobsKey: REVIEW_PREPARATION_JOBS_STORAGE_KEY,
        budgetSettingsKey: OPENAI_BUDGET_SETTINGS_STORAGE_KEY,
        budgetLedgerKey: OPENAI_BUDGET_LEDGER_STORAGE_KEY,
        configurationKey: OPENAI_CONFIGURATION_STORAGE_KEY,
        apiKeyKey: OPENAI_API_KEY_STORAGE_KEY,
        evidencePackStateKey: EVIDENCE_PACK_STATE_STORAGE_KEY,
        configuration: DEFAULT_OPENAI_CONFIGURATION,
        sourceSenseId: evidence.sourceSenseId,
        responses: [
          completed({
            type: 'contrastive',
            learningItemId: 'learning-background',
            encounterId: 'encounter-background',
            knowledgeDimension: 'contextual-meaning',
            prompt: 'What does postpone mean here?',
            contextQuote: "Let's postpone the exam",
            acceptedAnswers: ['delay until later'],
            distractors: ['cancel permanently'],
            correctiveExplanation:
              'Here, postpone means moving the vote to a later time.',
          }),
          completed({
            grounding: 'pass',
            answerability: 'pass',
            linguisticAccuracy: 'pass',
            constructValidity: 'pass',
            distractorSafety: 'pass',
            correctiveExplanation: 'pass',
            validAlternativeAnswers: [],
            partialAnswers: [],
            evidenceAssessments: [
              {
                evidenceId: evidence.id,
                relation: 'supports',
              },
            ],
          }),
          completed({
            type: 'contrastive',
            learningItemId: 'learning-background',
            encounterId: 'encounter-background',
            knowledgeDimension: 'usage-fit',
            prompt: 'Does postpone fit this context?',
            contextQuote: "Let's postpone the exam",
            acceptedAnswers: ['yes, it fits'],
            distractors: ['no, it does not fit'],
            correctiveExplanation:
              'Postpone fits this attested sense context.',
            claimedFit: 'fits',
          }),
          completed({
            grounding: 'pass',
            answerability: 'pass',
            linguisticAccuracy: 'pass',
            constructValidity: 'pass',
            distractorSafety: 'pass',
            correctiveExplanation: 'pass',
            validAlternativeAnswers: [],
            partialAnswers: [],
            evidenceAssessments: [
              {
                evidenceId: usageEvidence.id,
                relation: 'supports',
              },
            ],
          }),
        ],
      },
    );

    await expect
      .poll(async () =>
        worker.evaluate(async (approvedKey) => {
          const stored = await chrome.storage.local.get(approvedKey);
          const records = (
            stored[approvedKey] as
              | { records?: Array<{ knowledgeDimension?: string }> }
              | undefined
          )?.records;
          return records?.map((item) => item.knowledgeDimension) ?? [];
        }, APPROVED_REVIEW_ITEMS_STORAGE_KEY),
      )
      .toContain('contextual-meaning');
    await expect
      .poll(() =>
        worker.evaluate(async (schedulesKey) => {
          const stored = await chrome.storage.local.get(schedulesKey);
          return stored[schedulesKey];
        }, REVIEW_SCHEDULES_STORAGE_KEY),
      )
      .toMatchObject({
        records: [
          {
            learningItemId: 'learning-background',
            knowledgeDimension: 'contextual-meaning',
            demonstratedCount: 2,
            intervalStage: 3,
          },
        ],
      });
    await restartExtension();
    await expect
      .poll(async () =>
        worker.evaluate(async (approvedKey) => {
          const stored = await chrome.storage.local.get(approvedKey);
          const records = (
            stored[approvedKey] as
              | { records?: Array<{ knowledgeDimension?: string }> }
              | undefined
          )?.records;
          return records?.map((item) => item.knowledgeDimension) ?? [];
        }, APPROVED_REVIEW_ITEMS_STORAGE_KEY),
      )
      .toContain('usage-fit');

    const providerRequests = await worker.evaluate(async () => {
      const stored =
        await chrome.storage.local.get('openAiTestRequests');
      return Array.isArray(stored.openAiTestRequests)
        ? stored.openAiTestRequests
        : [];
    });
    expect(
      providerRequests.map(
        (request: { text?: { format?: { name?: string } } }) =>
          request.text?.format?.name,
      ),
    ).toEqual([
      'review_candidate_contextual_meaning',
      'review_candidate_evaluation',
      'review_candidate_usage_fit',
      'review_candidate_evaluation',
    ]);

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ openAiTestOnline: false });
    });
    await restartExtension();
    const sidePanel = await context.newPage();
    await sidePanel.goto(
      `${extensionOriginFrom(worker)}/sidepanel.html`,
    );
    await sidePanel.getByRole('tab', { name: 'Review' }).click();
    await expect
      .poll(() =>
        sidePanel
          .getByText('目前有 1 個 Learning Items 可以複習。')
          .isVisible(),
      )
      .toBe(true);
    await sidePanel
      .getByText('背景準備（2）', { exact: true })
      .click();
    await sidePanel.screenshot({
      path: resolve(
        'docs/assets/issue-15-background-preparation.png',
      ),
      fullPage: true,
    });
    await sidePanel
      .getByRole('button', { name: '開始 Review' })
      .click();
    await expect
      .poll(() =>
        worker.evaluate(async ([sessionsKey, approvedKey]) => {
          const stored = await chrome.storage.local.get([
            sessionsKey,
            approvedKey,
          ]);
          const session = (
            stored[sessionsKey] as
              | {
                  records?: Array<{
                    status?: string;
                    reviewItemIds?: string[];
                  }>;
                }
              | undefined
          )?.records?.find((candidate) => candidate.status === 'active');
          const approvedIds = new Set(
            (
              stored[approvedKey] as
                | { records?: Array<{ id?: string }> }
                | undefined
            )?.records?.map((item) => item.id) ?? [],
          );
          return {
            reviewItemCount: session?.reviewItemIds?.length,
            everyItemApproved:
              session?.reviewItemIds?.every((id) => approvedIds.has(id)) ??
              false,
          };
        }, [
          REVIEW_SESSIONS_STORAGE_KEY,
          APPROVED_REVIEW_ITEMS_STORAGE_KEY,
        ] as const),
      )
      .toEqual({ reviewItemCount: 1, everyItemApproved: true });
    await expect
      .poll(() =>
        sidePanel
          .getByText(
            /^(?:What does postpone mean here|Does postpone fit this context)\?$/,
          )
          .isVisible(),
      )
      .toBe(true);
    await sidePanel.screenshot({
      path: resolve('docs/assets/issue-15-offline-review-ready.png'),
      fullPage: true,
    });
    expect(
      await worker.evaluate(async () => {
        const stored =
          await chrome.storage.local.get('openAiTestRequests');
        return Array.isArray(stored.openAiTestRequests)
          ? stored.openAiTestRequests.length
          : 0;
      }),
    ).toBe(4);
    await sidePanel.close();
  }, 60_000);

  it('exports and transactionally restores portable state from Settings while offline without replacing device credentials', async () => {
    await worker.evaluate(
      async ([lookupKey, resetKeys]) => {
        await chrome.storage.local.remove([lookupKey, ...resetKeys]);
        await chrome.storage.local.set({
          [lookupKey]: {
            version: 1,
            records: [
              {
                version: 1,
                id: 'portable-workflow-lookup',
                selection: {
                  text: 'portable',
                  context: {
                    before: 'This lookup must ',
                    after: ' survive a fresh-profile import.',
                  },
                },
                action: {
                  type: 'quick-hint',
                  result: {
                    simplerExpression: 'movable between profiles',
                    explanationCue: '可攜式',
                  },
                },
                completedAt: '2026-08-16T05:00:00.000Z',
                usage: { source: 'cache', attempts: 0, provider: null },
              },
            ],
          },
        });
      },
      [
        LOOKUP_RECORDS_STORAGE_KEY,
        [
          LEARNING_STATE_STORAGE_KEY,
          LEARNER_NOTES_STORAGE_KEY,
          APPROVED_REVIEW_ITEMS_STORAGE_KEY,
          REVIEW_EVIDENCE_STORAGE_KEY,
          REVIEW_SCHEDULES_STORAGE_KEY,
          REVIEW_SESSIONS_STORAGE_KEY,
          PORTABLE_RECORD_PROVENANCE_STORAGE_KEY,
          IMPORT_REPORTS_STORAGE_KEY,
          IMPORT_STAGING_STORAGE_KEY,
        ],
      ] as const,
    );
    const options = await context.newPage();
    await options.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => ({
          createWritable: async () => ({
            write: async (blob: Blob) => {
              (
                window as unknown as { capturedPortableBackup?: string }
              ).capturedPortableBackup = await blob.text();
            },
            close: async () => undefined,
          }),
        }),
      });
    });
    await options.goto(`${extensionOriginFrom(worker)}/options.html`);
    const importFile = options.locator('#import-portable-backup-file');
    await importFile.focus();
    expect(
      await options
        .locator('label[for="import-portable-backup-file"]')
        .evaluate((element) => getComputedStyle(element).outlineWidth),
    ).toBe('2px');
    await activateByKeyboard(
      options.getByRole('button', { name: '選擇位置並匯出備份' }),
    );
    await expect
      .poll(() =>
        options.evaluate(
          () =>
            (
              window as unknown as { capturedPortableBackup?: string }
            ).capturedPortableBackup?.length ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    const backupText = await options.evaluate(
      () =>
        (
          window as unknown as { capturedPortableBackup?: string }
        ).capturedPortableBackup ?? '',
    );
    const backupDocument = JSON.parse(backupText) as {
      state: {
        lookupRecords: { records: unknown[] };
        learning: { learningItems: unknown[] };
        settings: {
          openAi: { model: { id: string } };
        };
      };
    };
    const deviceState = await worker.evaluate(
      async ([apiKey, evidencePack]) => {
        const stored = await chrome.storage.local.get([apiKey, evidencePack]);
        return {
          apiKey: stored[apiKey],
          activeVersion: (
            stored[evidencePack] as { activeVersion?: string } | undefined
          )?.activeVersion,
        };
      },
      [OPENAI_API_KEY_STORAGE_KEY, EVIDENCE_PACK_STATE_STORAGE_KEY] as const,
    );
    await worker.evaluate(
      async (keys) => {
        await chrome.storage.local.remove(keys);
      },
      [
        LOOKUP_RECORDS_STORAGE_KEY,
        LEARNING_STATE_STORAGE_KEY,
        LEARNER_NOTES_STORAGE_KEY,
        APPROVED_REVIEW_ITEMS_STORAGE_KEY,
        REVIEW_EVIDENCE_STORAGE_KEY,
        REVIEW_SCHEDULES_STORAGE_KEY,
        REVIEW_SESSIONS_STORAGE_KEY,
        OPENAI_CONFIGURATION_STORAGE_KEY,
        OPENAI_BUDGET_SETTINGS_STORAGE_KEY,
        PORTABLE_PREFERENCES_STORAGE_KEY,
        PORTABLE_RECORD_PROVENANCE_STORAGE_KEY,
        IMPORT_REPORTS_STORAGE_KEY,
        IMPORT_STAGING_STORAGE_KEY,
        REVIEW_PREPARATION_JOBS_STORAGE_KEY,
      ],
    );

    await context.setOffline(true);
    try {
      await options
        .locator('#import-portable-backup-file')
        .setInputFiles({
          name: 'invalid-utf8.json',
          mimeType: 'application/json',
          buffer: Buffer.from([0xff]),
        });
      await expect
        .poll(() => options.locator('#portable-backup-status').textContent())
        .toBe('備份不是有效的 UTF-8。');
      await options
        .locator('#import-portable-backup-file')
        .setInputFiles({
          name: 'lingo-palette-backup.json',
          mimeType: 'application/json',
          buffer: Buffer.from(backupText, 'utf8'),
        });
      await expect
        .poll(() => options.locator('#portable-backup-status').textContent())
        .toBe(
          '備份已在 staging 完成完整驗證與 migration；目前 learner state 尚未變更。',
        );
      await expect
        .poll(() =>
          options
            .getByRole('heading', { name: '提交前 Import Report' })
            .isVisible(),
        )
        .toBe(true);
      await options.screenshot({
        path: resolve('docs/assets/issue-16-import-preview.png'),
        fullPage: true,
      });
      await activateByKeyboard(
        options.getByRole('button', { name: '確認原子提交' }),
      );
      await expect
        .poll(() =>
          options
            .getByRole('heading', { name: /^Import Report / })
            .count(),
        )
        .toBeGreaterThan(0);
      await options.screenshot({
        path: resolve('docs/assets/issue-16-import-report.png'),
        fullPage: true,
      });
    } finally {
      await context.setOffline(false);
    }

    const restored = await worker.evaluate(
      async ([lookupKey, learningKey, configurationKey, apiKey, evidencePack]) => {
        const stored = await chrome.storage.local.get([
          lookupKey,
          learningKey,
          configurationKey,
          apiKey,
          evidencePack,
        ]);
        return {
          lookupCount: (
            stored[lookupKey] as { records?: unknown[] } | undefined
          )?.records?.length,
          learningItemCount: (
            stored[learningKey] as
              | { learningItems?: unknown[] }
              | undefined
          )?.learningItems?.length,
          modelId: (
            stored[configurationKey] as
              | { model?: { id?: string } }
              | undefined
          )?.model?.id,
          apiKey: stored[apiKey],
          activeVersion: (
            stored[evidencePack] as { activeVersion?: string } | undefined
          )?.activeVersion,
        };
      },
      [
        LOOKUP_RECORDS_STORAGE_KEY,
        LEARNING_STATE_STORAGE_KEY,
        OPENAI_CONFIGURATION_STORAGE_KEY,
        OPENAI_API_KEY_STORAGE_KEY,
        EVIDENCE_PACK_STATE_STORAGE_KEY,
      ] as const,
    );
    expect(restored).toEqual({
      lookupCount: backupDocument.state.lookupRecords.records.length,
      learningItemCount: backupDocument.state.learning.learningItems.length,
      modelId: backupDocument.state.settings.openAi.model.id,
      apiKey: deviceState.apiKey,
      activeVersion: deviceState.activeVersion,
    });
    await options.close();
    observedSmokeFlows.set(
      'backup-import',
      'Backup export and the reviewed atomic import commit completed from keyboard focus and Enter activation.',
    );
    observedAnnouncementStates.set(
      'import',
      'Import preview, commit, and report states were announced in the Settings status region.',
    );
  }, 60_000);

  it('passes the maintained 20-page, 10-domain Supported Reading Surface smoke matrix', async () => {
    const pageRuns: SupportedPageRun[] = [];
    expect(SUPPORTED_PAGE_SMOKE_PLAN).toHaveLength(20);
    expect(
      new Set(SUPPORTED_PAGE_SMOKE_PLAN.map((pageCase) => pageCase.domain)).size,
    ).toBe(10);
    expect(
      new Set(SUPPORTED_PAGE_SMOKE_PLAN.map((pageCase) => pageCase.surface)),
    ).toEqual(new Set(['top-level', 'same-origin-embedded']));
    expect(
      new Set(
        SUPPORTED_PAGE_SMOKE_PLAN.map((pageCase) => pageCase.selectionKind),
      ),
    ).toEqual(new Set(['word', 'phrase', 'sentence', 'multi-sentence']));
    expect(
      new Set(SUPPORTED_PAGE_SMOKE_PLAN.map((pageCase) => pageCase.zoomPercent)),
    ).toEqual(new Set([100, 200]));
    await worker.evaluate(
      async ([id, matches]) => {
        const registration = {
          id,
          js: ['/reading-flow.js'],
          matches: [...matches],
          allFrames: true,
          matchOriginAsFallback: true,
          persistAcrossSessions: true,
        };
        const existing = await chrome.scripting.getRegisteredContentScripts({
          ids: [id],
        });
        if (existing.length === 0) {
          await chrome.scripting.registerContentScripts([registration]);
        } else {
          await chrome.scripting.updateContentScripts([registration]);
        }
      },
      [
        scriptIdFor(origin),
        [`${origin}/*`, ...smokeMatchPatterns()],
      ] as const,
    );
    await page.emulateMedia({
      reducedMotion: 'reduce',
      forcedColors: 'active',
    });

    for (const pageCase of SUPPORTED_PAGE_SMOKE_PLAN) {
      await page.goto(smokePageUrl(pageCase));
      const tabId = await activeReadingTabId();
      await worker.evaluate(
        ([id, zoom]) => chrome.tabs.setZoom(id, zoom),
        [tabId, pageCase.zoomPercent / 100] as const,
      );
      const target = await smokeSelectionTarget(pageCase);
      await expect
        .poll(
          () =>
            target
              .locator('[data-lingo-palette-reading-flow-initialized]')
              .count(),
          {
            message: `Expected Reading Flow initialization for smoke case ${pageCase.id}.`,
          },
        )
        .toBe(1);
      const selection = target.locator('#smoke-selection');
      await selection.scrollIntoViewIfNeeded();
      await selection.focus();

      if (pageCase.input === 'pointer') {
        await selectSmokeTextByPointer(
          target,
          '#smoke-selection',
          pageCase.selectionText,
        );
      } else {
        await selectTextByKeyboard(
          target,
          '#smoke-selection',
          pageCase.selectionText,
        );
      }
      expect(await target.evaluate(() => document.activeElement?.id)).toBe(
        'smoke-selection',
      );
      const toolbar = target.getByRole('toolbar', {
        name: 'Lingo Palette 選取工具',
      });
      await expect
        .poll(() => toolbar.isVisible(), {
          message: `Expected Reading Flow toolbar for smoke case ${pageCase.id}.`,
        })
        .toBe(true);
      const host = target.locator('[data-lingo-palette-reading-flow]');
      const accessibleMedia = await toolbar.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          borderTopWidth: style.borderTopWidth,
        };
      });
      expect(accessibleMedia.animationName).toBe('none');
      expect(Number.parseFloat(accessibleMedia.borderTopWidth)).toBeGreaterThanOrEqual(
        2,
      );
      await expect
        .poll(() => host.getAttribute('data-selection-stable-at'))
        .not.toBeNull();
      const timing = await host.evaluate((element) => ({
        selectionStableAt: Number(
          (element as HTMLElement).dataset.selectionStableAt,
        ),
        visibleAt: Number((element as HTMLElement).dataset.visibleAt),
      }));
      const latency = timing.visibleAt - timing.selectionStableAt;
      expect(latency).toBeGreaterThanOrEqual(0);
      expect(latency).toBeLessThanOrEqual(250);
      await assertSmokeSurfaceInsideViewport(target);
      pageRuns.push({ pageCase, milliseconds: latency });

      const shortcut = await configuredToolbarShortcut();
      expect(shortcut).toBe(
        process.platform === 'darwin' ? 'Command+Shift+L' : 'Ctrl+Shift+Y',
      );
      await worker.evaluate(async (activeTabId) => {
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId, allFrames: true },
          func: () =>
            window.dispatchEvent(
              new Event('lingo-palette:focus-selection-toolbar'),
            ),
        });
      }, tabId);
      const quickHint = target.getByRole('button', { name: '快速提示' });
      await expect
        .poll(() =>
          quickHint.evaluate(
            (button) =>
              button === (button.getRootNode() as ShadowRoot).activeElement,
          ),
        )
        .toBe(true);
      const focusPresentation = await quickHint.evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          outlineWidth: style.outlineWidth,
          borderStyle: style.borderStyle,
        };
      });
      expect(focusPresentation.outlineWidth).not.toBe('0px');
      expect(focusPresentation.borderStyle).not.toBe('none');

      await page.keyboard.press('Escape');
      await expect.poll(() => toolbar.count()).toBe(0);
      expect(await target.evaluate(() => document.activeElement?.id)).toBe(
        'smoke-selection',
      );
      await worker.evaluate(async (activeTabId) => {
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId, allFrames: true },
          func: () =>
            window.dispatchEvent(
              new Event('lingo-palette:focus-selection-toolbar'),
            ),
        });
      }, tabId);
      await expect
        .poll(() =>
          quickHint.evaluate(
            (button) =>
              button === (button.getRootNode() as ShadowRoot).activeElement,
          ),
        )
        .toBe(true);
      let focusLeftSurface = false;
      for (let index = 0; index < 30; index += 1) {
        await page.keyboard.press('Tab');
        focusLeftSurface = await host.evaluate(
          (element) => element.shadowRoot?.activeElement === null,
        );
        if (focusLeftSurface) break;
      }
      expect(focusLeftSurface).toBe(true);
      await worker.evaluate((id) => chrome.tabs.setZoom(id, 1), tabId);
    }

    const grouped = smokeLatencyGroups(
      pageRuns.map(({ pageCase, milliseconds }) => ({
        input: pageCase.input,
        surface: pageCase.surface,
        milliseconds,
      })),
    );
    expect(grouped).toHaveLength(4);
    for (const group of grouped) {
      expect(group.p95Ms).toBeLessThanOrEqual(100);
      expect(group.maxMs).toBeLessThanOrEqual(250);
    }
    await page.emulateMedia({
      reducedMotion: 'no-preference',
      forcedColors: 'none',
    });
    completedSupportedPageRuns = pageRuns;
    completedSmokeLatencyGroups = grouped;
  }, 60_000);

  it('keeps a separately enabled cross-origin embedded document outside Supported Reading Surfaces', async () => {
    await page.goto(
      `http://site-01.lingo.test:${serverPort}/excluded-cross-origin`,
    );
    await expect
      .poll(() =>
        page.frames().some((frame) =>
          frame.url().endsWith('/cross-origin-child'),
        ),
      )
      .toBe(true);
    const crossOriginFrame = page
      .frames()
      .find((frame) => frame.url().endsWith('/cross-origin-child'));
    if (crossOriginFrame === undefined) {
      throw new Error('Expected the cross-origin smoke frame.');
    }

    await selectTextByKeyboard(
      crossOriginFrame,
      '#cross-origin-selection',
      'postpone',
    );
    await crossOriginFrame.waitForTimeout(150);

    expect(
      await crossOriginFrame
        .getByRole('toolbar', { name: 'Lingo Palette 選取工具' })
        .count(),
    ).toBe(0);
    observedExcludedSurfaces.set(
      'cross-origin-embedded',
      'A separately enabled cross-origin child never received Reading Flow controls.',
    );
  });

  it('keeps form and editor selections outside Supported Reading Surfaces', async () => {
    await page.goto(`http://site-03.lingo.test:${serverPort}/excluded-editor`);
    await selectNodeContents(page, '#editable-copy');
    await page.waitForTimeout(150);

    expect(
      await page
        .getByRole('toolbar', { name: 'Lingo Palette 選取工具' })
        .count(),
    ).toBe(0);
    observedExcludedSurfaces.set(
      'form-or-editor',
      'Form and contenteditable Selections never produced Reading Flow controls.',
    );
  });

  it('reports browser, extension, PDF, local-file, and pixel-only pages as unsupported', async () => {
    const localFile = join(profilePath, 'excluded-local.html');
    await writeFile(
      localFile,
      '<!doctype html><html><body><p>Local file text is excluded.</p></body></html>',
    );
    const excludedPages = [
      { kind: 'browser-page', url: 'chrome://version/' },
      {
        kind: 'extension-page',
        url: `${extensionOriginFrom(worker)}/options.html`,
      },
      {
        kind: 'pdf-viewer',
        url: `http://site-04.lingo.test:${serverPort}/excluded.pdf`,
      },
      { kind: 'local-file', url: pathToFileURL(localFile).href },
      {
        kind: 'canvas-or-image-text',
        url: `http://site-04.lingo.test:${serverPort}/excluded-canvas`,
      },
    ] as const;

    for (const excludedPage of excludedPages) {
      await page.goto(excludedPage.url);
      if (excludedPage.kind === 'canvas-or-image-text') {
        const canvas = page.locator('canvas');
        const bounds = await canvas.boundingBox();
        if (bounds === null) throw new Error('Expected the smoke canvas.');
        await page.mouse.move(bounds.x + 4, bounds.y + 4);
        await page.mouse.down();
        await page.mouse.move(
          bounds.x + bounds.width - 4,
          bounds.y + bounds.height - 4,
        );
        await page.mouse.up();
      }
      await page.waitForTimeout(100);
      expect(
        await page.locator('[data-lingo-palette-reading-flow]').count(),
        excludedPage.kind,
      ).toBe(0);
      observedExcludedSurfaces.set(
        excludedPage.kind,
        `${excludedPage.kind} completed without Reading Flow controls.`,
      );
    }
  });

  it('writes evidence only for smoke observations completed by this run', async () => {
    expect(completedSupportedPageRuns).toHaveLength(20);
    expect(completedSmokeLatencyGroups).toHaveLength(4);
    expect(observedSmokeFlows.size).toBe(SMOKE_FLOW_NAMES.length);
    expect(observedAnnouncementStates.size).toBe(
      SMOKE_ANNOUNCEMENT_STATES.length,
    );
    expect(observedExcludedSurfaces.size).toBe(
      SMOKE_EXCLUDED_SURFACE_KINDS.length,
    );
    await writeSupportedPageSmokeArtifacts(
      completedSupportedPageRuns,
      completedSmokeLatencyGroups,
    );
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
async function activateByKeyboard(control: Locator): Promise<void> {
  await control.focus();
  const focusPresentation = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focused: element.matches(':focus'),
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusPresentation.focused).toBe(true);
  expect(focusPresentation.outlineWidth).toBeGreaterThanOrEqual(2);
  await control.press('Enter');
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

function smokeMatchPatterns(): string[] {
  return [
    ...new Set(
      SUPPORTED_PAGE_SMOKE_PLAN.map(
        (pageCase) => `http://${pageCase.domain}/*`,
      ),
    ),
  ];
}

function smokePageUrl(pageCase: SupportedPageSmokeCase): string {
  return `http://${pageCase.domain}:${serverPort}${pageCase.path}`;
}

function renderSmokeFixture(
  requestUrl: string | undefined,
  requestHost: string | undefined,
): string | null {
  const url = new URL(requestUrl ?? '/', `http://${requestHost ?? 'localhost'}`);
  if (
    url.hostname === 'site-01.lingo.test' &&
    url.pathname === '/excluded-cross-origin'
  ) {
    return `<!doctype html><html><body>
      <iframe title="Cross-origin excluded surface" src="http://site-02.lingo.test:${serverPort}/cross-origin-child"></iframe>
    </body></html>`;
  }
  if (
    url.hostname === 'site-02.lingo.test' &&
    url.pathname === '/cross-origin-child'
  ) {
    return `<!doctype html><html><body>
      <p id="cross-origin-selection" tabindex="0">They agreed to postpone the vote.</p>
    </body></html>`;
  }
  if (
    url.hostname === 'site-03.lingo.test' &&
    url.pathname === '/excluded-editor'
  ) {
    return `<!doctype html><html><body>
      <label>Draft <textarea>The editor will postpone publication.</textarea></label>
      <p id="editable-copy" contenteditable="true">The editor will postpone publication.</p>
    </body></html>`;
  }
  if (
    url.hostname === 'site-04.lingo.test' &&
    url.pathname === '/excluded-canvas'
  ) {
    return `<!doctype html><html><body>
      <canvas width="640" height="240" aria-label="Words baked into pixels"></canvas>
      <img alt="Text visible only inside an image" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
    </body></html>`;
  }
  const pageCase = SUPPORTED_PAGE_SMOKE_PLAN.find(
    (candidate) =>
      candidate.domain === url.hostname && candidate.path === url.pathname,
  );
  if (pageCase !== undefined) {
    if (pageCase.surface === 'same-origin-embedded') {
      return `<!doctype html><html><head><title>${pageCase.id}</title></head><body>
        <main>
          <button id="smoke-reading-position">Reading position</button>
          <iframe title="Same-origin reading surface" src="/smoke-frame/${pageCase.id}" style="width: 900px; height: 560px"></iframe>
        </main>
      </body></html>`;
    }
    return renderSmokeSelectionDocument(pageCase);
  }

  const frameId = url.pathname.startsWith('/smoke-frame/')
    ? decodeURIComponent(url.pathname.slice('/smoke-frame/'.length))
    : null;
  if (frameId === null) return null;
  const frameCase = SUPPORTED_PAGE_SMOKE_PLAN.find(
    (candidate) =>
      candidate.domain === url.hostname && candidate.id === frameId,
  );
  return frameCase === undefined
    ? null
    : renderSmokeSelectionDocument(frameCase);
}

function renderSmokeSelectionDocument(
  pageCase: SupportedPageSmokeCase,
): string {
  const placementClass =
    pageCase.placement === 'after-scroll' ? 'after-scroll' : 'viewport-edge';
  return `<!doctype html><html><head><title>${pageCase.id}</title>
    <style>
      html, body { margin: 0; min-height: 100%; font: 18px/1.6 system-ui, sans-serif; }
      main { box-sizing: border-box; display: flex; flex-direction: column; min-height: 100vh; padding: 24px; }
      #smoke-selection { max-width: 680px; padding: 8px; }
      #smoke-selection.viewport-edge { align-self: flex-end; margin-top: auto; text-align: right; }
      #smoke-selection.after-scroll { margin-top: 1400px; }
    </style></head><body><main>
      <button id="smoke-reading-position">Reading position</button>
      <p id="smoke-selection" class="${placementClass}" tabindex="0">${escapeHtml(pageCase.paragraph)}</p>
    </main></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function smokeSelectionTarget(
  pageCase: SupportedPageSmokeCase,
): Promise<Page | Frame> {
  if (pageCase.surface === 'top-level') return page;
  await expect
    .poll(() =>
      page.frames().some((frame) =>
        frame.url().endsWith(`/smoke-frame/${pageCase.id}`),
      ),
    )
    .toBe(true);
  const frame = page
    .frames()
    .find((candidate) =>
      candidate.url().endsWith(`/smoke-frame/${pageCase.id}`),
    );
  if (frame === undefined) throw new Error(`Missing frame for ${pageCase.id}.`);
  return frame;
}

async function selectSmokeTextByPointer(
  target: Page | Frame,
  selector: string,
  text: string,
): Promise<number> {
  const points = await target.locator(selector).evaluate(
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
  let offset = { x: 0, y: 0 };
  if ('frameElement' in target) {
    const frameElement = await target.frameElement();
    const box = await frameElement.boundingBox();
    if (box === null) throw new Error('Expected a visible same-origin frame.');
    offset = { x: box.x, y: box.y };
  }
  await page.mouse.move(points.start.x + offset.x, points.start.y + offset.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x + offset.x, points.end.y + offset.y, {
    steps: 8,
  });
  const selectionAt = await target.evaluate(() => performance.now());
  await page.mouse.up();
  return selectionAt;
}

async function assertSmokeSurfaceInsideViewport(
  target: Page | Frame,
): Promise<void> {
  const bounds = await target
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
  const viewport = await target.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(viewport.width);
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
}

async function configuredToolbarShortcut(): Promise<string | undefined> {
  return worker.evaluate(async () => {
    const commands = await chrome.commands.getAll();
    return commands.find(({ name }) => name === 'focus-selection-toolbar')
      ?.shortcut;
  });
}

type SmokeLatencyGroup = {
  input: SupportedPageSmokeCase['input'];
  surface: SupportedPageSmokeCase['surface'];
  p95Ms: number;
  maxMs: number;
};

function smokeLatencyGroups(
  samples: ReadonlyArray<{
    input: SupportedPageSmokeCase['input'];
    surface: SupportedPageSmokeCase['surface'];
    milliseconds: number;
  }>,
): SmokeLatencyGroup[] {
  const groups = new Map<string, number[]>();
  for (const sample of samples) {
    const key = `${sample.input}\u0000${sample.surface}`;
    const values = groups.get(key);
    if (values === undefined) groups.set(key, [sample.milliseconds]);
    else values.push(sample.milliseconds);
  }
  return [...groups].map(([key, values]) => {
    const [input, surface] = key.split('\u0000') as [
      SupportedPageSmokeCase['input'],
      SupportedPageSmokeCase['surface'],
    ];
    const { p95Ms, maxMs } = summarizeSmokeLatencyValues(values);
    return { input, surface, p95Ms, maxMs };
  });
}

async function writeSupportedPageSmokeArtifacts(
  pageRuns: ReadonlyArray<{
    pageCase: SupportedPageSmokeCase;
    milliseconds: number;
  }>,
  groups: readonly SmokeLatencyGroup[],
): Promise<void> {
  const artifactDirectory = process.env.SMOKE_EVIDENCE_DIR;
  const requestedScreenshot = process.env.SMOKE_SCREENSHOT_PATH;
  if (artifactDirectory === undefined && requestedScreenshot === undefined) {
    return;
  }

  const platform =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : process.platform;
  const browserVersion = await page.evaluate(() => navigator.userAgent);
  const recordedAt = new Date().toISOString();
  const environmentId = `${platform}-chrome-automated`;
  const extensionCommit =
    process.env.GITHUB_SHA ??
    (await executeFile('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const fullMatrix = process.env.SMOKE_FULL_MATRIX === 'true';
  const evidence = {
    schemaVersion: 1,
    runId: `supported-page-smoke-${platform}-${recordedAt}`,
    recordedAt,
    environments: [
      {
        id: environmentId,
        os: platform,
        osVersion: release(),
        browserVersion,
        extensionCommit,
      },
    ],
    plan: SUPPORTED_PAGE_SMOKE_PLAN.map(
      ({ selectionText: _selectionText, paragraph: _paragraph, ...pageCase }) =>
        pageCase,
    ),
    pageRuns: pageRuns.map(({ pageCase, milliseconds }) => ({
      caseId: pageCase.id,
      environmentId,
      permissionState: 'enabled',
      expected:
        'Anchored controls remain visible, preserve Selection focus, restore it on Escape, and remain non-modal.',
      observed:
        'Automated browser smoke passed viewport, Selection-focus, Escape, tab-exit, and animation-frame latency checks.',
      outcome: 'passed',
      accessibilityMethods: ['keyboard-only', 'visual-focus', 'automated'],
      defectLinks: [],
      latencyMs: Number(milliseconds.toFixed(3)),
      focus: {
        pointerSelectionPreserved: true,
        escapeRestored: true,
        nonModalNoTrap: true,
      },
    })),
    excludedSurfaceRuns: fullMatrix
      ? Array.from(
          observedExcludedSurfaces,
          ([surfaceKind, observed]) => ({
            environmentId,
            surfaceKind,
            permissionState: 'excluded',
            expected: 'No Reading Flow controls are injected.',
            observed,
            outcome: 'unsupported',
            accessibilityMethods: ['automated'],
            defectLinks: [],
          }),
        )
      : [],
    flowRuns: fullMatrix
      ? Array.from(observedSmokeFlows, ([flow, observed]) => ({
          environmentId,
          flow,
          keyboardOnly: true,
          visibleFocus: true,
          nonColorCue: true,
          expected: 'The extension-owned flow is operable without a pointer.',
          observed,
          defectLinks: [],
        }))
      : [],
    announcementRuns: fullMatrix
      ? Array.from(observedAnnouncementStates, ([state, observed]) => ({
          environmentId,
          state,
          announced: true,
          focusMoved: false,
          expected: 'The state is announced without unnecessary focus movement.',
          observed,
          defectLinks: [],
        }))
      : [],
    accessibilityRuns: [
      {
        environmentId,
        reducedMotion: true,
        highContrast: true,
        assistiveTechnology: platform === 'windows' ? 'nvda' : 'voiceover',
        manualScreenReader: false,
        configuredCommandEntered: false,
        expected: `Complete core flow passes the actual configured browser command and manual ${platform === 'windows' ? 'NVDA' : 'VoiceOver'} smoke.`,
        observed:
          'Automated reduced-motion, forced-colors, manifest-shortcut, and command-handler checks passed; the actual browser shortcut and manual screen reader are not inferred.',
        defectLinks: [],
      },
    ],
  };

  const screenshotPaths: string[] = [];
  if (artifactDirectory !== undefined) {
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      join(artifactDirectory, `supported-pages-${platform}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    screenshotPaths.push(
      join(artifactDirectory, `supported-pages-${platform}.png`),
    );
  }
  if (requestedScreenshot !== undefined) {
    screenshotPaths.push(resolve(requestedScreenshot));
  }
  if (screenshotPaths.length === 0) return;

  const rows = pageRuns
    .map(
      ({ pageCase, milliseconds }) => `<tr>
        <td>${escapeHtml(pageCase.id)}</td>
        <td>${escapeHtml(pageCase.domain)}</td>
        <td>${escapeHtml(pageCase.surface)}</td>
        <td>${escapeHtml(pageCase.selectionKind)} / ${escapeHtml(pageCase.input)}</td>
        <td>${pageCase.placement} / ${pageCase.zoomPercent}%</td>
        <td>${milliseconds.toFixed(2)} ms</td>
        <td><strong>PASS</strong></td>
      </tr>`,
    )
    .join('');
  const groupCards = groups
    .map(
      (group) => `<article>
        <strong>${escapeHtml(group.input)} / ${escapeHtml(group.surface)}</strong>
        <span>p95 ${group.p95Ms.toFixed(2)} ms</span>
        <span>max ${group.maxMs.toFixed(2)} ms</span>
      </article>`,
    )
    .join('');
  await page.setContent(`<!doctype html><html><head><title>Issue 17 smoke evidence</title>
    <style>
      :root { color-scheme: light; font: 15px/1.45 system-ui, sans-serif; }
      body { margin: 0; padding: 32px; color: #162033; background: #eef3f8; }
      header, section { max-width: 1180px; margin: 0 auto 24px; }
      h1 { margin: 0 0 8px; font-size: 30px; }
      .lede { margin: 0; color: #44516a; }
      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
      article { display: grid; gap: 6px; padding: 16px; border: 1px solid #a9b7c9; border-radius: 8px; background: white; }
      table { width: 100%; border-collapse: collapse; background: white; }
      th, td { padding: 9px 10px; border: 1px solid #c4cedb; text-align: left; }
      th { background: #dce7f3; }
      td:last-child { color: #075d34; }
      footer { max-width: 1180px; margin: 16px auto 0; color: #44516a; }
    </style></head><body>
      <header>
        <h1>Issue 17 — automated Supported Reading Surface smoke</h1>
        <p class="lede">${pageRuns.length} pages · 10 domains · ${escapeHtml(platform)} · ${escapeHtml(recordedAt)}</p>
      </header>
      <section class="summary">${groupCards}</section>
      <section><table>
        <thead><tr><th>Case</th><th>Domain</th><th>Surface</th><th>Selection / input</th><th>Placement / zoom</th><th>Local latency</th><th>Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></section>
      <footer>Provider latency is excluded. The actual browser shortcut and manual NVDA/VoiceOver evidence are never inferred from this automated report.</footer>
    </body></html>`);
  for (const screenshotPath of screenshotPaths) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
}

function minimalPdf(): Buffer {
  const stream = 'BT /F1 12 Tf 72 72 Td (Excluded PDF surface) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n`;
  source += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, 'ascii');
}
