import { describe, expect, it } from 'vitest';
import {
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
} from '../review/review-storage-keys';
import {
  createBrowserApprovedReviewRevalidationPort,
  createBrowserEvidencePackLifecycleStorage,
  createTrustedEvidencePackTransport,
  type BrowserStorageArea,
} from './evidence-pack-browser-adapters';
import type { EvidencePackState } from './evidence-pack-lifecycle';

function createStorageArea(): BrowserStorageArea & {
  failNextWrite(): void;
} {
  const values: Record<string, unknown> = {};
  let shouldFail = false;
  return {
    failNextWrite() {
      shouldFail = true;
    },
    async get(key) {
      return { [key]: structuredClone(values[key]) };
    },
    async set(items) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('simulated quota failure');
      }
      Object.assign(values, structuredClone(items));
    },
  };
}

const activeState: EvidencePackState = {
  version: 1,
  activeVersion: '2025.1.0',
  rollbackVersion: null,
  revalidationSweeps: [],
  installedCandidates: {
    '2025.1.0': 'a'.repeat(64),
  },
};

describe('browser Evidence Pack lifecycle storage', () => {
  it('recovers the active pointer after suspension and preserves it when a commit fails', async () => {
    const storageArea = createStorageArea();
    const firstWorker = createBrowserEvidencePackLifecycleStorage(storageArea);
    await firstWorker.commit(activeState);

    const resumedWorker = createBrowserEvidencePackLifecycleStorage(storageArea);
    expect(await resumedWorker.loadState()).toEqual(activeState);

    storageArea.failNextWrite();
    await expect(
      resumedWorker.commit({
        ...activeState,
        activeVersion: '2025.2.0',
        rollbackVersion: '2025.1.0',
      }),
    ).rejects.toThrow('simulated quota failure');
    expect(await resumedWorker.loadState()).toEqual(activeState);
  });

  it('persists idempotent sidecar markers without mutating approved Review Item provenance', async () => {
    const storageArea = createStorageArea();
    const approvedState = {
      version: 1,
      records: [
        {
          id: 'review-b',
          task: { prompt: 'B' },
          provenance: {
            evidencePack: { version: '2025.1.0', contentIdentity: 'old-b' },
          },
        },
        {
          id: 'review-a',
          task: { prompt: 'A' },
          provenance: {
            evidencePack: { version: '2025.1.0', contentIdentity: 'old-a' },
          },
        },
        {
          id: 'review-new',
          task: { prompt: 'new' },
          provenance: {
            evidencePack: { version: '2025.2.0', contentIdentity: 'new' },
          },
        },
      ],
    };
    await storageArea.set({
      [APPROVED_REVIEW_ITEMS_STORAGE_KEY]: approvedState,
    });
    const port = createBrowserApprovedReviewRevalidationPort(storageArea);
    await expect(
      port.listApprovedByEvidencePack({
        evidencePackVersion: '2025.1.0',
        afterReviewItemId: null,
        limit: 1,
      }),
    ).resolves.toEqual({
      reviewItemIds: ['review-a'],
      nextCursor: 'review-a',
    });
    const marker = {
      reviewItemId: 'review-a',
      sweepId: 'sweep-1',
      fromEvidencePackVersion: '2025.1.0',
      toEvidencePackVersion: '2025.2.0',
    };
    await port.markRevalidationPending(marker);
    await port.markRevalidationPending(marker);

    expect(
      (await storageArea.get(APPROVED_REVIEW_ITEMS_STORAGE_KEY))[
        APPROVED_REVIEW_ITEMS_STORAGE_KEY
      ],
    ).toEqual(approvedState);
    expect(
      (await storageArea.get(REVIEW_REVALIDATION_MARKERS_STORAGE_KEY))[
        REVIEW_REVALIDATION_MARKERS_STORAGE_KEY
      ],
    ).toEqual({
      version: 1,
      records: {
        'sweep-1:review-a': {
          ...marker,
          status: 'pending',
          execution: 'background-budgeted',
        },
      },
    });
  });

  it('fails closed instead of erasing malformed review revalidation state', async () => {
    const storageArea = createStorageArea();
    await storageArea.set({
      [APPROVED_REVIEW_ITEMS_STORAGE_KEY]: {
        version: 99,
        records: [],
      },
      [REVIEW_REVALIDATION_MARKERS_STORAGE_KEY]: {
        version: 99,
        records: {},
      },
    });
    const port = createBrowserApprovedReviewRevalidationPort(storageArea);
    await expect(
      port.listApprovedByEvidencePack({
        evidencePackVersion: '2025.1.0',
        afterReviewItemId: null,
        limit: 25,
      }),
    ).rejects.toMatchObject({ code: 'storage-invalid' });
    await expect(
      port.markRevalidationPending({
        reviewItemId: 'review-a',
        sweepId: 'sweep-1',
        fromEvidencePackVersion: '2025.1.0',
        toEvidencePackVersion: '2025.2.0',
      }),
    ).rejects.toMatchObject({ code: 'storage-invalid' });
    expect(
      (await storageArea.get(REVIEW_REVALIDATION_MARKERS_STORAGE_KEY))[
        REVIEW_REVALIDATION_MARKERS_STORAGE_KEY
      ],
    ).toEqual({ version: 99, records: {} });
  });

  it('constructs the only remote URL in trusted code and bounds the streamed bytes', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Length': '3' },
      });
    };
    const transport = createTrustedEvidencePackTransport(fetcher);

    await expect(
      transport.fetchAsset(
        { language: 'en', version: '2025.1.0' },
        'manifest.json',
        3,
      ),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(requestedUrl).toBe(
      'https://tzurae.github.io/lingo-palette-evidence/en/2025.1.0/manifest.json',
    );
    expect(requestedInit).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });

    await expect(
      transport.fetchAsset(
        { language: 'en', version: 'https://attacker.example/payload' },
        'manifest.json',
        3,
      ),
    ).rejects.toMatchObject({ code: 'unsupported-release' });
    expect(requestedUrl).toBe(
      'https://tzurae.github.io/lingo-palette-evidence/en/2025.1.0/manifest.json',
    );
  });

  it('rejects declared and streamed downloads that cross the caller cap', async () => {
    const release = { language: 'en', version: '2025.1.0' } as const;
    const declaredTooLarge = createTrustedEvidencePackTransport(
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'Content-Length': '4' },
        }),
    );
    await expect(
      declaredTooLarge.fetchAsset(release, 'manifest.json', 3),
    ).rejects.toMatchObject({ code: 'size-limit' });

    const streamedTooLarge = createTrustedEvidencePackTransport(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
              controller.enqueue(new Uint8Array([3, 4]));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );
    await expect(
      streamedTooLarge.fetchAsset(release, 'manifest.json', 3),
    ).rejects.toMatchObject({ code: 'size-limit' });
  });
});
