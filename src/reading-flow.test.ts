import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import type { BrowserContext, Frame, Page, Worker } from 'playwright-core';

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
        <p id="frame-copy">They agreed to postpone the vote until next week.</p>
      </body></html>`);
      return;
    }

    response.end(`<!doctype html><html><body>
      <main>
        <button id="reading-position">Reading position</button>
        <p id="copy">The committee decided to postpone the vote until next week.</p>
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
    ],
  });
  
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (siteOrigin) => {
    await chrome.scripting.registerContentScripts([
      {
        id: 'reading-flow-browser-test',
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
    });
  }, origin);
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
    const probePage = await context.newPage();
    await probePage.goto(`${extensionOriginFrom(worker)}/options.html`);
    const controlledResponse = await probePage.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'quick-hint',
        selection: {
          text: 'postpone',
          context: { before: 'to ', after: ' the vote' },
        },
      }),
    );
    await probePage.close();
    if (controlledResponse.status === 'failed') {
      throw new Error(controlledResponse.message);
    }
    expect(controlledResponse).toMatchObject({
      status: 'completed',
      result: { simplerExpression: 'delay until a later time' },
    });


    await page.locator('#reading-position').focus();
    const selectionAt = await selectText(page, '#copy', 'postpone');
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
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      'reading-position',
    );

    await page.getByRole('button', { name: '快速提示' }).click();
    await expect
      .poll(() => page.getByRole('status').textContent())
      .toBe('快速提示已完成。');
    await expect
      .poll(() => page.getByText('delay until a later time').isVisible())
      .toBe(true);
    await expect
      .poll(() => page.getByText('延後原本安排的事情').isVisible())
      .toBe(true);
  });

  it('reports an over-limit Selection without truncating or enabling Quick Hint', async () => {
    await selectNodeContents(page, '#long-copy');

    await expect
      .poll(() => page.getByText(/超過 4,000 個字元/).isVisible())
      .toBe(true);
    await expect
      .poll(() => page.getByRole('button', { name: '快速提示' }).isDisabled())
      .toBe(true);
  });

  it('keeps the anchored surface in view at page edges, after scroll, and at 200% zoom', async () => {
    const tabId = await activeReadingTabId();
    await worker.evaluate(
      ([id, zoom]) => chrome.tabs.setZoom(id, zoom),
      [tabId, 2] as const,
    );
    await page.locator('#edge-copy').scrollIntoViewIfNeeded();
    await selectText(page, '#edge-copy', 'postpone');
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
    await page.evaluate(() => document.getSelection()?.removeAllRanges());
    await frame.locator('#frame-position').focus();
    await selectText(frame, '#frame-copy', 'postpone');

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
    expect(
      await frame.evaluate(() => document.activeElement?.id),
    ).toBe('frame-position');
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



async function selectText(
  target: Page | Frame,
  selector: string,
  text: string,
): Promise<number> {
  return target.locator(selector).evaluate((element, selectedText) => {
    const selectionAt = performance.now();
    const node = element.firstChild;
    if (!(node instanceof Text)) throw new Error('Expected a text node.');
    const start = node.data.indexOf(selectedText);
    if (start < 0) throw new Error(`Could not select ${selectedText}.`);
    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + selectedText.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return selectionAt;
  }, text);
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
