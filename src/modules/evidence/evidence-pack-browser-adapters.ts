import { z } from 'zod';
import {
  APPROVED_REVIEW_ITEMS_STORAGE_KEY,
  REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
} from '../review/review-storage-keys';
import {
  evidencePackAssetUrl,
  EvidencePackLifecycleError,
  type ApprovedReviewRevalidationPort,
  type EvidencePackLifecycleStorage,
  type EvidencePackState,
  type EvidencePackTransport,
  type StagedEvidencePack,
} from './evidence-pack-lifecycle';
import {
  evidencePackManifestSchema,
  evidencePackPayloadSchema,
} from './evidence-pack-schema';

export const EVIDENCE_PACK_STATE_STORAGE_KEY = 'activeEvidencePackV1';
const EVIDENCE_PACK_CANDIDATE_STORAGE_PREFIX = 'evidencePackCandidateV1:';

const revalidationSweepSchema = z
  .object({
    id: z.string().min(1),
    fromEvidencePackVersion: z.string().min(1),
    toEvidencePackVersion: z.string().min(1),
    status: z.enum(['pending', 'completed']),
    execution: z.literal('background-budgeted'),
    requestedAt: z.iso.datetime(),
    cursor: z.string().min(1).nullable(),
    markedItemCount: z.number().int().nonnegative(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();

const evidencePackStateSchema = z
  .object({
    version: z.literal(1),
    activeVersion: z.string().nullable(),
    rollbackVersion: z.string().nullable(),
    revalidationSweeps: z.array(revalidationSweepSchema),
    installedCandidates: z.record(
      z.string().regex(/^\d+\.\d+\.\d+$/),
      z.string().regex(/^[0-9a-f]{64}$/),
    ),
  })
  .strict();

const stagedEvidencePackSchema = z
  .object({
    candidateId: z.string().regex(/^[0-9a-f]{64}$/),
    stagedAt: z.iso.datetime(),
    manifest: evidencePackManifestSchema,
    payload: evidencePackPayloadSchema,
  })
  .strict();

const approvedReviewItemsSchema = z
  .object({
    version: z.literal(1),
    records: z.array(
      z
        .object({
          id: z.string().min(1),
          provenance: z
            .object({
              evidencePack: z
                .object({ version: z.string().min(1) })
                .passthrough(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .strict();

const revalidationMarkerSchema = z
  .object({
    reviewItemId: z.string().min(1),
    sweepId: z.string().min(1),
    fromEvidencePackVersion: z.string().min(1),
    toEvidencePackVersion: z.string().min(1),
    status: z.literal('pending'),
    execution: z.literal('background-budgeted'),
  })
  .strict();

const revalidationMarkersSchema = z
  .object({
    version: z.literal(1),
    records: z.record(z.string(), revalidationMarkerSchema),
  })
  .strict();

export interface BrowserStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function createBrowserEvidencePackLifecycleStorage(
  storage: BrowserStorageArea,
): EvidencePackLifecycleStorage {
  return {
    async loadState() {
      const stored = await storage.get(EVIDENCE_PACK_STATE_STORAGE_KEY);
      const value = stored[EVIDENCE_PACK_STATE_STORAGE_KEY];
      if (value === undefined) {
        return {
          version: 1,
          activeVersion: null,
          rollbackVersion: null,
          revalidationSweeps: [],
          installedCandidates: {},
        };
      }
      return evidencePackStateSchema.parse(value);
    },

    async loadStaged(candidateId) {
      if (!/^[0-9a-f]{64}$/.test(candidateId)) return null;
      const key = `${EVIDENCE_PACK_CANDIDATE_STORAGE_PREFIX}${candidateId}`;
      const stored = await storage.get(key);
      const value = stored[key];
      return value === undefined ? null : stagedEvidencePackSchema.parse(value);
    },

    async stage(candidate) {
      const parsed = stagedEvidencePackSchema.parse(candidate);
      await storage.set({
        [`${EVIDENCE_PACK_CANDIDATE_STORAGE_PREFIX}${parsed.candidateId}`]:
          parsed,
      });
    },

    async commit(nextState: EvidencePackState) {
      const parsed = evidencePackStateSchema.parse(nextState);
      await storage.set({ [EVIDENCE_PACK_STATE_STORAGE_KEY]: parsed });
    },
  };
}

export function createTrustedEvidencePackTransport(
  fetcher: typeof fetch = fetch,
): EvidencePackTransport {
  return {
    async fetchAsset(release, asset, maximumBytes) {
      const response = await fetcher(evidencePackAssetUrl(release, asset), {
        cache: 'no-store',
        credentials: 'omit',

        redirect: 'error',
      });
      if (!response.ok || response.body === null) {
        throw new Error(`Evidence Pack download returned HTTP ${response.status}.`);
      }
      const contentLength = response.headers.get('Content-Length');
      if (
        contentLength !== null &&
        Number.isFinite(Number(contentLength)) &&
        Number(contentLength) > maximumBytes
      ) {
        await response.body.cancel();
        throw new EvidencePackLifecycleError(
          'size-limit',
          `Evidence Pack asset exceeds ${maximumBytes} bytes.`,
        );
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > maximumBytes) {
          await reader.cancel();
          throw new EvidencePackLifecycleError(
            'size-limit',
            `Evidence Pack asset exceeds ${maximumBytes} bytes.`,
          );
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    },
  };
}
export function createBrowserApprovedReviewRevalidationPort(
  storage: BrowserStorageArea,
): ApprovedReviewRevalidationPort {
  let pending = Promise.resolve();
  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = pending;
    const completion = Promise.withResolvers<void>();
    pending = completion.promise;
    await previous;
    try {
      return await operation();
    } finally {
      completion.resolve();
    }
  };

  return {
    async listApprovedByEvidencePack({
      evidencePackVersion,
      afterReviewItemId,
      limit,
    }) {
      const stored = await storage.get(APPROVED_REVIEW_ITEMS_STORAGE_KEY);
      const raw = stored[APPROVED_REVIEW_ITEMS_STORAGE_KEY];
      if (raw === undefined) {
        return { reviewItemIds: [], nextCursor: null };
      }
      const parsed = approvedReviewItemsSchema.safeParse(raw);
      if (!parsed.success) {
        throw new EvidencePackLifecycleError(
          'storage-invalid',
          'Approved Review Item storage is malformed.',
          { cause: parsed.error },
        );
      }
      const eligibleIds = parsed.data.records
        .filter(
          (item) =>
            item.provenance.evidencePack.version === evidencePackVersion &&
            (afterReviewItemId === null || item.id > afterReviewItemId),
        )
        .map((item) => item.id)
        .sort((left, right) => left.localeCompare(right, 'en'));
      const reviewItemIds = eligibleIds.slice(0, limit);
      const lastId = reviewItemIds.at(-1);
      return {
        reviewItemIds,
        nextCursor:
          lastId !== undefined && eligibleIds.length > reviewItemIds.length
            ? lastId
            : null,
      };
    },

    async markRevalidationPending(input) {
      await serialized(async () => {
        const marker = revalidationMarkerSchema.parse({
          ...input,
          status: 'pending',
          execution: 'background-budgeted',
        });
        const stored = await storage.get(
          REVIEW_REVALIDATION_MARKERS_STORAGE_KEY,
        );
        const raw = stored[REVIEW_REVALIDATION_MARKERS_STORAGE_KEY];
        const parsed =
          raw === undefined
            ? {
                success: true as const,
                data: { version: 1 as const, records: {} },
              }
            : revalidationMarkersSchema.safeParse(raw);
        if (!parsed.success) {
          throw new EvidencePackLifecycleError(
            'storage-invalid',
            'Review revalidation marker storage is malformed.',
            { cause: parsed.error },
          );
        }
        const state = parsed.data;
        const key = `${marker.sweepId}:${marker.reviewItemId}`;
        if (state.records[key] !== undefined) return;
        await storage.set({
          [REVIEW_REVALIDATION_MARKERS_STORAGE_KEY]: {
            ...state,
            records: { ...state.records, [key]: marker },
          },
        });
      });
    },
  };
}
