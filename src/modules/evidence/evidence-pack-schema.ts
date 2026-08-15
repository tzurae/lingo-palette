import { z } from 'zod';
import {
  MAX_EVIDENCE_PACK_COMPRESSED_BYTES,
  MAX_EVIDENCE_PACK_INSTALLED_BYTES,
} from './evidence-pack-catalog.ts';

const semverPattern = /^\d+\.\d+\.\d+$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const packPathPattern =
  /^(?:sources|licenses)\/[A-Za-z0-9._/-]+\.(?:json|md|tsv|txt)$/i;
const forbiddenPackDirectoryPattern =
  /(?:^|\/)(?:prompts?|templates?|instructions?|commands?|migrations?|executables?)(?:\/|$)/i;

export function isEvidencePackDataPath(value: string): boolean {
  const segments = value.split('/');
  return (
    packPathPattern.test(value) &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    !forbiddenPackDirectoryPattern.test(value)
  );
}

const sourceSchema = z
  .object({
    id: z.string().min(1).max(80),
    version: z.string().min(1).max(80),
    asset: z.string().min(1).max(200),
    sourceUrl: z.url().refine((value) => value.startsWith('https://')),
    sha256: z.string().regex(sha256Pattern),
    hashAuthority: z.enum(['publisher', 'locally-computed']),
    changes: z.string().trim().min(1).max(2_000),
  })
  .strict();

const fileMetadataSchema = z
  .object({
    path: z.string().refine(isEvidencePackDataPath),
    byteSize: z.number().int().nonnegative(),
    sha256: z.string().regex(sha256Pattern),
  })
  .strict();

const licenseSchema = z
  .object({
    id: z.string().min(1).max(120),
    sourceIds: z.array(z.string().min(1).max(80)).min(1).max(8),
    filePaths: z
      .array(
        z
          .string()
          .refine(
            (value) =>
              value.startsWith('licenses/') &&
              isEvidencePackDataPath(value),
          ),
      )
      .min(1)
      .max(8),
    attribution: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const evidencePackManifestSchema = z
  .object({
    id: z.literal('lingo-palette-en-evidence'),
    schemaVersion: z.literal(1),
    semanticVersion: z.string().regex(semverPattern),
    language: z.literal('en'),
    minimumExtensionVersion: z.string().regex(semverPattern),
    compression: z.literal('gzip'),
    compressedSizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_EVIDENCE_PACK_COMPRESSED_BYTES),
    installedSizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_EVIDENCE_PACK_INSTALLED_BYTES),
    payloadSha256: z.string().regex(sha256Pattern),
    contentIdentitySha256: z.string().regex(sha256Pattern),
    sources: z.array(sourceSchema).min(1).max(16),
    files: z.array(fileMetadataSchema).min(1).max(256),
    licenses: z.array(licenseSchema).min(1).max(32),
  })
  .strict();

const payloadFileSchema = z
  .object({
    path: z.string().refine(isEvidencePackDataPath),
    content: z.string(),
  })
  .strict();

export const evidencePackPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: z.literal('en'),
    version: z.string().regex(semverPattern),
    files: z.array(payloadFileSchema).min(1).max(256),
  })
  .strict();

export type EvidencePackManifest = z.infer<typeof evidencePackManifestSchema>;
export type EvidencePackPayload = z.infer<typeof evidencePackPayloadSchema>;
