import { z } from 'zod';

const countsSchema = z
  .object({
    added: z.record(z.string(), z.number().int().nonnegative()),
    identicalSkipped: z.record(z.string(), z.number().int().nonnegative()),
    divergentPreserved: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
const collisionSchema = z
  .object({
    id: z.string().min(1),
    recordKind: z.string().min(1),
    originalId: z.string().min(1),
    importedId: z.string().min(1),
    local: z.unknown(),
    imported: z.unknown(),
    acknowledged: z.boolean(),
  })
  .strict();
const previewSchema = z
  .object({
    stageId: z.string().min(1),
    sourceBackupId: z.string().min(1),
    sourceExportedAt: z.iso.datetime(),
    counts: countsSchema,
    collisions: z.array(collisionSchema),
  })
  .strict();
const reportSchema = previewSchema.extend({
  id: z.string().min(1),
  status: z.literal('committed'),
  committedAt: z.iso.datetime(),
});

const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('export-portable-backup') }).strict(),
  z
    .object({
      type: z.literal('stage-portable-backup'),
      bytesBase64: z.base64(),
    })
    .strict(),
  z
    .object({
      type: z.literal('commit-portable-backup'),
      stageId: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal('get-import-reports') }).strict(),
  z
    .object({
      type: z.literal('acknowledge-import-collision'),
      reportId: z.string().min(1),
      collisionId: z.string().min(1),
    })
    .strict(),
]);
const responseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('exported'),
      filename: z.string().min(1),
      text: z.string(),
      warning: z.string().min(1),
    })
    .strict(),
  z.object({ status: z.literal('staged'), preview: previewSchema }).strict(),
  z.object({ status: z.literal('committed'), report: reportSchema }).strict(),
  z.object({ status: z.literal('reports'), reports: z.array(reportSchema) }).strict(),
  z.object({ status: z.literal('acknowledged'), report: reportSchema }).strict(),
  z
    .object({
      status: z.literal('failed'),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);

export type PortableBackupRequest = z.infer<typeof requestSchema>;
export type PortableBackupResponse = z.infer<typeof responseSchema>;
export type PortableImportPreview = z.infer<typeof previewSchema>;
export type PortableImportReport = z.infer<typeof reportSchema>;

export function parsePortableBackupRequest(value: unknown): PortableBackupRequest {
  return requestSchema.parse(value);
}

export function parsePortableBackupResponse(value: unknown): PortableBackupResponse {
  return responseSchema.parse(value);
}
