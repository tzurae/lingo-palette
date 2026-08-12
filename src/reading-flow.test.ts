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
  await worker.evaluate(async ([siteOrigin, scriptId]) => {
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
    });
  }, [origin, scriptIdFor(origin)] as const);
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
      .toBe('快速提示已完成。');
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
