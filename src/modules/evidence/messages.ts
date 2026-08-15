import { z } from 'zod';
import type { SupportedEvidencePackRelease } from './evidence-pack-catalog';
import type {
  EvidencePackInspection,
  EvidencePackState,
} from './evidence-pack-lifecycle';

export type EvidencePackRequest =
  | { type: 'get-evidence-pack-status' }
  | {
      type: 'inspect-evidence-pack';
      language: 'en';
      version: string;
    }
  | {
      type: 'confirm-evidence-pack-activation';
      candidateId: string;
    }
  | { type: 'rollback-evidence-pack' };

export type EvidencePackStatusSnapshot = Readonly<{
  state: EvidencePackState;
  supportedReleases: readonly SupportedEvidencePackRelease[];
}>;

export type EvidencePackResponse =
  | {
      status: 'loaded';
      snapshot: EvidencePackStatusSnapshot;
    }
  | {
      status: 'awaiting-confirmation';
      inspection: EvidencePackInspection;
    }
  | {
      status: 'activated' | 'rolled-back';
      snapshot: EvidencePackStatusSnapshot;
    }
  | {
      status: 'failed';
      code: string;
      message: string;
    };

const revalidationSweepSchema = z
  .object({
    id: z.string(),
    fromEvidencePackVersion: z.string(),
    toEvidencePackVersion: z.string(),
    status: z.enum(['pending', 'completed']),
    execution: z.literal('background-budgeted'),
    requestedAt: z.iso.datetime(),
    cursor: z.string().nullable(),
    markedItemCount: z.number().int().nonnegative(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();

const stateSchema = z
  .object({
    version: z.literal(1),
    activeVersion: z.string().nullable(),
    rollbackVersion: z.string().nullable(),
    revalidationSweeps: z.array(revalidationSweepSchema),
    installedCandidates: z.record(z.string(), z.string()),
  })
  .strict();

const snapshotSchema = z
  .object({
    state: stateSchema,
    supportedReleases: z.array(
      z
        .object({
          language: z.literal('en'),
          version: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

const inspectionSchema = z
  .object({
    status: z.literal('awaiting-confirmation'),
    candidateId: z.string().regex(/^[0-9a-f]{64}$/),
    language: z.literal('en'),
    version: z.string(),
    compressedSizeBytes: z.number().int().positive(),
    installedSizeBytes: z.number().int().positive(),
    sourceCount: z.number().int().positive(),
    attributions: z.array(z.string()),
  })
  .strict();

const responseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('loaded'), snapshot: snapshotSchema }).strict(),
  z
    .object({
      status: z.literal('awaiting-confirmation'),
      inspection: inspectionSchema,
    })
    .strict(),
  z
    .object({ status: z.literal('activated'), snapshot: snapshotSchema })
    .strict(),
  z
    .object({ status: z.literal('rolled-back'), snapshot: snapshotSchema })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      code: z.string(),
      message: z.string(),
    })
    .strict(),
]);

export function parseEvidencePackResponse(value: unknown): EvidencePackResponse {
  return responseSchema.parse(value);
}
