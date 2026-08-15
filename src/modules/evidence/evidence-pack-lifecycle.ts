import { verifyAsync } from '@noble/ed25519';
import {
  EVIDENCE_PACK_ORIGIN,
  FIRST_ENGLISH_EVIDENCE_SOURCES,
  MAX_EVIDENCE_PACK_COMPRESSED_BYTES,
  MAX_EVIDENCE_PACK_INSTALLED_BYTES,
  PACKAGED_EVIDENCE_PUBLIC_KEY_BASE64,
  SUPPORTED_EVIDENCE_PACK_RELEASES,
  type SupportedEvidencePackRelease,
} from './evidence-pack-catalog';
import {
  evidencePackManifestSchema,
  evidencePackPayloadSchema,
  type EvidencePackManifest,
  type EvidencePackPayload,
} from './evidence-pack-schema';

const semverPattern = /^\d+\.\d+\.\d+$/;

export type EvidencePackAsset =
  | 'manifest.json'
  | 'manifest.sig'
  | 'evidence-pack.json.gz';

export type EvidencePackRevalidationSweep = Readonly<{
  id: string;
  fromEvidencePackVersion: string;
  toEvidencePackVersion: string;
  status: 'pending' | 'completed';
  execution: 'background-budgeted';
  requestedAt: string;
  cursor: string | null;
  markedItemCount: number;
  completedAt: string | null;
}>;

export type EvidencePackState = Readonly<{
  version: 1;
  activeVersion: string | null;
  rollbackVersion: string | null;
  revalidationSweeps: readonly EvidencePackRevalidationSweep[];
  installedCandidates: Readonly<Record<string, string>>;
}>;

export type StagedEvidencePack = Readonly<{
  candidateId: string;
  stagedAt: string;
  manifest: EvidencePackManifest;
  payload: EvidencePackPayload;
}>;

export interface EvidencePackLifecycleStorage {
  loadState(): Promise<EvidencePackState>;
  loadStaged(candidateId: string): Promise<StagedEvidencePack | null>;
  stage(candidate: StagedEvidencePack): Promise<void>;
  commit(nextState: EvidencePackState): Promise<void>;
}

export interface ApprovedReviewRevalidationPort {
  listApprovedByEvidencePack(input: {
    evidencePackVersion: string;
    afterReviewItemId: string | null;
    limit: number;
  }): Promise<{
    reviewItemIds: readonly string[];
    nextCursor: string | null;
  }>;
  markRevalidationPending(input: {
    reviewItemId: string;
    sweepId: string;
    fromEvidencePackVersion: string;
    toEvidencePackVersion: string;
  }): Promise<void>;
}

export interface EvidencePackTransport {
  fetchAsset(
    release: SupportedEvidencePackRelease,
    asset: EvidencePackAsset,
    maximumBytes: number,
  ): Promise<Uint8Array>;
}

export interface EvidencePackSignatureVerifier {
  verify(manifestBytes: Uint8Array, signatureBytes: Uint8Array): Promise<boolean>;
}

export type EvidencePackInspection = Readonly<{
  status: 'awaiting-confirmation';
  candidateId: string;
  language: 'en';
  version: string;
  compressedSizeBytes: number;
  installedSizeBytes: number;
  sourceCount: number;
  attributions: readonly string[];
}>;

export class EvidencePackLifecycleError extends Error {
  constructor(
    readonly code:
      | 'unsupported-release'
      | 'download-failed'
      | 'size-limit'
      | 'signature-invalid'
      | 'manifest-invalid'
      | 'extension-incompatible'
      | 'payload-invalid'
      | 'integrity-invalid'
      | 'candidate-missing'
      | 'rollback-unavailable'
      | 'storage-invalid',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EvidencePackLifecycleError';
  }
}

export function evidencePackAssetUrl(
  release: SupportedEvidencePackRelease,
  asset: EvidencePackAsset,
): string {
  const supported = SUPPORTED_EVIDENCE_PACK_RELEASES.some(
    (candidate) =>
      candidate.language === release.language &&
      candidate.version === release.version,
  );
  if (!supported) {
    throw new EvidencePackLifecycleError(
      'unsupported-release',
      'Evidence Pack release is not packaged into trusted extension code.',
    );
  }
  return new URL(
    `${release.language}/${release.version}/${asset}`,
    EVIDENCE_PACK_ORIGIN,
  ).toString();
}

export function createEd25519SignatureVerifier(
  publicKey: Uint8Array,
): EvidencePackSignatureVerifier {
  if (publicKey.byteLength !== 32) {
    throw new TypeError('Ed25519 public key must contain exactly 32 bytes.');
  }
  const trustedPublicKey = publicKey.slice();
  return {
    async verify(manifestBytes, signatureBytes) {
      if (signatureBytes.byteLength !== 64) return false;
      try {
        return await verifyAsync(
          signatureBytes,
          manifestBytes,
          trustedPublicKey,
          { zip215: false },
        );
      } catch {
        return false;
      }
    },
  };
}

export function packagedEvidenceSignatureVerifier(): EvidencePackSignatureVerifier {
  return createEd25519SignatureVerifier(
    Uint8Array.from(atob(PACKAGED_EVIDENCE_PUBLIC_KEY_BASE64), (character) =>
      character.charCodeAt(0),
    ),
  );
}

export function createEvidencePackLifecycle(dependencies: {
  extensionVersion: string;
  fallbackEvidencePackVersion?: string;
  now?: () => string;
  signatureVerifier: EvidencePackSignatureVerifier;
  storage: EvidencePackLifecycleStorage;
  supportedReleases?: readonly SupportedEvidencePackRelease[];
  transport: EvidencePackTransport;
}) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const releaseCatalog =
    dependencies.supportedReleases ?? SUPPORTED_EVIDENCE_PACK_RELEASES;
  if (!semverPattern.test(dependencies.extensionVersion)) {
    throw new TypeError('Extension version must be semantic version x.y.z.');
  }

  return {
    async inspect(
      requestedRelease: SupportedEvidencePackRelease,
    ): Promise<EvidencePackInspection> {
      const release = releaseCatalog.find(
        (candidate) =>
          candidate.language === requestedRelease.language &&
          candidate.version === requestedRelease.version,
      );
      if (release === undefined) {
        throw new EvidencePackLifecycleError(
          'unsupported-release',
          'Evidence Pack release is not supported by this extension build.',
        );
      }

      const [manifestBytes, signatureBytes] = await Promise.all([
        fetchAsset(dependencies.transport, release, 'manifest.json', 1_000_000),
        fetchAsset(dependencies.transport, release, 'manifest.sig', 64),
      ]);
      if (
        !(await dependencies.signatureVerifier.verify(
          manifestBytes,
          signatureBytes,
        ))
      ) {
        throw new EvidencePackLifecycleError(
          'signature-invalid',
          'Evidence Pack manifest signature is invalid.',
        );
      }

      const manifest = parseManifest(manifestBytes);
      if (
        manifest.language !== release.language ||
        manifest.semanticVersion !== release.version
      ) {
        throw new EvidencePackLifecycleError(
          'manifest-invalid',
          'Signed manifest identity does not match the requested release.',
        );
      }
      validateManifestInventory(manifest);
      if (
        compareSemver(
          dependencies.extensionVersion,
          manifest.minimumExtensionVersion,
        ) < 0
      ) {
        throw new EvidencePackLifecycleError(
          'extension-incompatible',
          'Evidence Pack requires a newer extension version.',
        );
      }

      const compressedPayload = await fetchAsset(
        dependencies.transport,
        release,
        'evidence-pack.json.gz',
        MAX_EVIDENCE_PACK_COMPRESSED_BYTES,
      );
      if (
        compressedPayload.byteLength !== manifest.compressedSizeBytes ||
        (await sha256(compressedPayload)) !== manifest.payloadSha256
      ) {
        throw new EvidencePackLifecycleError(
          'integrity-invalid',
          'Compressed Evidence Pack does not match its signed manifest.',
        );
      }

      const payloadBytes = await decompressGzip(
        compressedPayload,
        MAX_EVIDENCE_PACK_INSTALLED_BYTES,
      );
      if (
        payloadBytes.byteLength !== manifest.installedSizeBytes ||
        (await sha256(payloadBytes)) !== manifest.contentIdentitySha256
      ) {
        throw new EvidencePackLifecycleError(
          'integrity-invalid',
          'Installed Evidence Pack does not match its signed manifest.',
        );
      }
      const payload = parsePayload(payloadBytes);
      await validatePayload(manifest, payload);

      const candidateId = await sha256(manifestBytes);
      await dependencies.storage.stage({
        candidateId,
        stagedAt: now(),
        manifest,
        payload,
      });

      return {
        status: 'awaiting-confirmation',
        candidateId,
        language: manifest.language,
        version: manifest.semanticVersion,
        compressedSizeBytes: manifest.compressedSizeBytes,
        installedSizeBytes: manifest.installedSizeBytes,
        sourceCount: manifest.sources.length,
        attributions: manifest.licenses.map((license) => license.attribution),
      };
    },

    async confirmActivation(input: { candidateId: string }): Promise<void> {
      const candidate = await dependencies.storage.loadStaged(input.candidateId);
      if (candidate === null) {
        throw new EvidencePackLifecycleError(
          'candidate-missing',
          'The inspected Evidence Pack candidate is no longer staged.',
        );
      }
      const state = await dependencies.storage.loadState();
      const activeVersion = candidate.manifest.semanticVersion;
      if (state.activeVersion === activeVersion) return;
      const requestedAt = now();
      const priorEvidencePackVersion =
        state.activeVersion ?? dependencies.fallbackEvidencePackVersion ?? null;
      const revalidationSweeps =
        priorEvidencePackVersion === null
          ? state.revalidationSweeps
          : [
              ...state.revalidationSweeps,
              {
                id: `${priorEvidencePackVersion}->${activeVersion}@${requestedAt}`,
                fromEvidencePackVersion: priorEvidencePackVersion,
                toEvidencePackVersion: activeVersion,
                status: 'pending' as const,
                execution: 'background-budgeted' as const,
                requestedAt,
                cursor: null,
                markedItemCount: 0,
                completedAt: null,
              },
            ];
      await dependencies.storage.commit({
        version: 1,
        activeVersion,
        rollbackVersion: priorEvidencePackVersion,
        revalidationSweeps,
        installedCandidates: {
          ...state.installedCandidates,
          [activeVersion]: candidate.candidateId,
        },
      });
    },

    async rollback(): Promise<void> {
      const state = await dependencies.storage.loadState();
      if (state.rollbackVersion === null) {
        throw new EvidencePackLifecycleError(
          'rollback-unavailable',
          'No prior known-good Evidence Pack is available.',
        );
      }
      const fallbackVersion = dependencies.fallbackEvidencePackVersion ?? null;
      const fromVersion = state.activeVersion ?? fallbackVersion;
      if (fromVersion === null) {
        throw new EvidencePackLifecycleError(
          'storage-invalid',
          'Current Evidence Pack version is unavailable.',
        );
      }
      const targetVersion = state.rollbackVersion;
      if (
        targetVersion !== fallbackVersion &&
        state.installedCandidates[targetVersion] === undefined
      ) {
        throw new EvidencePackLifecycleError(
          'storage-invalid',
          'Rollback Evidence Pack has no installed candidate mapping.',
        );
      }
      const requestedAt = now();
      await dependencies.storage.commit({
        version: 1,
        activeVersion:
          targetVersion === fallbackVersion ? null : targetVersion,
        rollbackVersion: fromVersion,
        revalidationSweeps: [
          ...state.revalidationSweeps,
          {
            id: `${fromVersion}->${targetVersion}@${requestedAt}`,
            fromEvidencePackVersion: fromVersion,
            toEvidencePackVersion: targetVersion,
            status: 'pending',
            execution: 'background-budgeted',
            requestedAt,
            cursor: null,
            markedItemCount: 0,
            completedAt: null,
          },
        ],
        installedCandidates: state.installedCandidates,
      });
    },

    async loadActive(): Promise<StagedEvidencePack | null> {
      const state = await dependencies.storage.loadState();
      if (state.activeVersion === null) return null;
      const candidateId = state.installedCandidates[state.activeVersion];
      if (candidateId === undefined) {
        throw new EvidencePackLifecycleError(

          'storage-invalid',
          'Active Evidence Pack has no installed candidate mapping.',
        );
      }
      const candidate = await dependencies.storage.loadStaged(candidateId);
      if (
        candidate === null ||
        candidate.manifest.semanticVersion !== state.activeVersion
      ) {
        throw new EvidencePackLifecycleError(
          'storage-invalid',
          'Active Evidence Pack payload is missing or mismatched.',
        );
      }
      return candidate;
    },
    async processNextRevalidationBatch(
      port: ApprovedReviewRevalidationPort,
      batchSize = 25,
    ): Promise<'idle' | 'pending' | 'completed'> {
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
        throw new TypeError('Revalidation batch size must be an integer from 1 to 100.');
      }
      const state = await dependencies.storage.loadState();
      const sweepIndex = state.revalidationSweeps.findIndex(
        (sweep) => sweep.status === 'pending',
      );
      if (sweepIndex < 0) return 'idle';
      const sweep = state.revalidationSweeps[sweepIndex];
      if (sweep === undefined) return 'idle';
      const batch = await port.listApprovedByEvidencePack({
        evidencePackVersion: sweep.fromEvidencePackVersion,
        afterReviewItemId: sweep.cursor,
        limit: batchSize,
      });
      if (batch.reviewItemIds.length > batchSize) {
        throw new EvidencePackLifecycleError(
          'storage-invalid',
          'Review revalidation port exceeded the requested batch size.',
        );
      }
      for (const reviewItemId of batch.reviewItemIds) {
        await port.markRevalidationPending({
          reviewItemId,
          sweepId: sweep.id,
          fromEvidencePackVersion: sweep.fromEvidencePackVersion,
          toEvidencePackVersion: sweep.toEvidencePackVersion,
        });
      }
      const completed = batch.nextCursor === null;
      const nextSweep: EvidencePackRevalidationSweep = {
        ...sweep,
        status: completed ? 'completed' : 'pending',
        cursor: batch.nextCursor,
        markedItemCount:
          sweep.markedItemCount + batch.reviewItemIds.length,
        completedAt: completed ? now() : null,
      };
      const revalidationSweeps = state.revalidationSweeps.map((item, index) =>
        index === sweepIndex ? nextSweep : item,
      );
      await dependencies.storage.commit({
        ...state,
        revalidationSweeps,
      });
      return revalidationSweeps.some((item) => item.status === 'pending')
        ? 'pending'
        : 'completed';
    },

    snapshot(): Promise<EvidencePackState> {
      return dependencies.storage.loadState();
    },
  };
}

async function fetchAsset(
  transport: EvidencePackTransport,
  release: SupportedEvidencePackRelease,
  asset: EvidencePackAsset,
  maximumBytes: number,
): Promise<Uint8Array> {
  try {
    const bytes = await transport.fetchAsset(release, asset, maximumBytes);
    if (bytes.byteLength > maximumBytes) {
      throw new Error(`Asset exceeds ${maximumBytes} bytes.`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof EvidencePackLifecycleError) throw error;
    throw new EvidencePackLifecycleError(
      'download-failed',
      `Evidence Pack ${asset} download failed.`,
      { cause: error },
    );
  }
}

function parseManifest(bytes: Uint8Array): EvidencePackManifest {
  try {
    return evidencePackManifestSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
  } catch (error) {
    throw new EvidencePackLifecycleError(
      'manifest-invalid',
      'Signed Evidence Pack manifest is invalid.',
      { cause: error },
    );
  }
}

function parsePayload(bytes: Uint8Array): EvidencePackPayload {
  try {
    return evidencePackPayloadSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
  } catch (error) {
    throw new EvidencePackLifecycleError(
      'payload-invalid',
      'Evidence Pack payload is not valid data-only content.',
      { cause: error },
    );
  }
}

function validateManifestInventory(manifest: EvidencePackManifest): void {
  if (manifest.sources.length !== FIRST_ENGLISH_EVIDENCE_SOURCES.length) {
    throw new EvidencePackLifecycleError(
      'manifest-invalid',
      'Evidence Pack source inventory is incomplete.',
    );
  }
  for (const expected of FIRST_ENGLISH_EVIDENCE_SOURCES) {
    const source = manifest.sources.find(
      (candidate) => candidate.id === expected.id,
    );
    if (
      source === undefined ||
      source.version !== expected.version ||
      source.asset !== expected.asset ||
      source.sourceUrl !== expected.sourceUrl ||
      source.sha256 !== expected.sha256 ||
      source.hashAuthority !== expected.hashAuthority
    ) {
      throw new EvidencePackLifecycleError(
        'manifest-invalid',
        `Evidence Pack source is not the pinned ${expected.id} input.`,
      );
    }
  }

  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  const filePaths = new Set(manifest.files.map((file) => file.path));
  if (sourceIds.size !== manifest.sources.length || filePaths.size !== manifest.files.length) {
    throw new EvidencePackLifecycleError(
      'manifest-invalid',
      'Evidence Pack manifest contains duplicate source or file identifiers.',
    );
  }
  const licensedSourceIds = new Set<string>();
  for (const license of manifest.licenses) {
    for (const sourceId of license.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        throw new EvidencePackLifecycleError(
          'manifest-invalid',
          'Evidence Pack license refers to an unknown source.',
        );
      }
      licensedSourceIds.add(sourceId);
    }
    if (
      license.filePaths.some(
        (path) => !path.startsWith('licenses/') || !filePaths.has(path),
      )
    ) {
      throw new EvidencePackLifecycleError(
        'manifest-invalid',
        'Evidence Pack license text is absent from the signed file inventory.',
      );
    }
  }
  if (
    FIRST_ENGLISH_EVIDENCE_SOURCES.some(
      (source) => !licensedSourceIds.has(source.id),
    )
  ) {
    throw new EvidencePackLifecycleError(
      'manifest-invalid',
      'Evidence Pack source is missing license and attribution coverage.',
    );
  }
}

async function validatePayload(
  manifest: EvidencePackManifest,
  payload: EvidencePackPayload,
): Promise<void> {
  if (
    payload.language !== manifest.language ||
    payload.version !== manifest.semanticVersion ||
    payload.files.length !== manifest.files.length
  ) {
    throw new EvidencePackLifecycleError(
      'integrity-invalid',
      'Evidence Pack payload identity does not match its manifest.',
    );
  }
  const manifestFiles = new Map(manifest.files.map((file) => [file.path, file]));
  const seenPaths = new Set<string>();
  for (const file of payload.files) {
    const metadata = manifestFiles.get(file.path);
    if (metadata === undefined || seenPaths.has(file.path)) {
      throw new EvidencePackLifecycleError(
        'integrity-invalid',
        'Evidence Pack files do not match the signed inventory.',
      );
    }
    seenPaths.add(file.path);
    const contentBytes = new TextEncoder().encode(file.content);
    if (
      contentBytes.byteLength !== metadata.byteSize ||
      (await sha256(contentBytes)) !== metadata.sha256
    ) {
      throw new EvidencePackLifecycleError(
        'integrity-invalid',
        `Evidence Pack file integrity mismatch: ${file.path}`,
      );
    }
  }
}

async function decompressGzip(
  compressed: Uint8Array,
  maximumBytes: number,
): Promise<Uint8Array> {
  try {
    const stream = new Blob([compressed.slice()])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new Error(`Expanded payload exceeds ${maximumBytes} bytes.`);
      }
      chunks.push(value);
    }
    const output = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } catch (error) {
    throw new EvidencePackLifecycleError(
      'payload-invalid',
      'Evidence Pack gzip payload could not be decompressed safely.',
      { cause: error },
    );
  }
}

async function sha256(value: Uint8Array): Promise<string> {
  const digestInput = Uint8Array.from(value).buffer;
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', digestInput),
  );
  let hexadecimal = '';
  for (const byte of digest) hexadecimal += byte.toString(16).padStart(2, '0');
  return hexadecimal;
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
