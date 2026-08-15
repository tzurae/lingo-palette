import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createEd25519SignatureVerifier,
  createEvidencePackLifecycle,
  type EvidencePackLifecycleStorage,
  type EvidencePackAsset,
  type EvidencePackState,
  type StagedEvidencePack,
} from './evidence-pack-lifecycle';
import {
  MAX_EVIDENCE_PACK_COMPRESSED_BYTES,
  MAX_EVIDENCE_PACK_INSTALLED_BYTES,
} from './evidence-pack-catalog';
import {
  evidencePackManifestSchema,
  evidencePackPayloadSchema,
  type EvidencePackManifest,
} from './evidence-pack-schema';

const encoder = new TextEncoder();

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createMemoryStorage(
  initialState: EvidencePackState = {
    version: 1,
    activeVersion: null,
    rollbackVersion: null,
    revalidationSweeps: [],
    installedCandidates: {},
  },
): EvidencePackLifecycleStorage & {
  staged: Map<string, StagedEvidencePack>;
  failNextStage(): void;
  failNextCommit(): void;
} {
  let state: EvidencePackState = structuredClone(initialState);
  let shouldFailStage = false;
  let shouldFailCommit = false;
  const staged = new Map<string, StagedEvidencePack>();

  return {
    staged,
    failNextStage() {
      shouldFailStage = true;
    },
    failNextCommit() {
      shouldFailCommit = true;
    },
    async loadState() {
      return structuredClone(state);
    },
    async loadStaged(candidateId) {
      return structuredClone(staged.get(candidateId) ?? null);
    },
    async stage(candidate) {
      if (shouldFailStage) {
        shouldFailStage = false;
        throw new Error('simulated staging interruption');
      }
      staged.set(candidate.candidateId, structuredClone(candidate));
    },
    async commit(nextState) {
      if (shouldFailCommit) {
        shouldFailCommit = false;
        throw new Error('simulated activation interruption');
      }
      state = structuredClone(nextState);
    },
  };
}

async function createSignedRelease(
  version: string,
  keyPair?: { privateKey: KeyObject; publicKey: KeyObject },
) {
  const files = [
    {
      path: 'sources/oewn/contextual-meanings.json',
      content: '[{"id":"oewn:02648898-v","definition":"hold back to a later time"}]\n',
    },
    { path: 'sources/wordfreq/en.tsv', content: 'postpone\t3.71\n' },
    {
      path: 'sources/leipzig/eng_news_2023_100K-sentences.tsv',
      content: '1\tThe vote was postponed until next week.\n',
    },
    { path: 'licenses/OEWN-2025-LICENSE.md', content: 'CC BY 4.0 attribution text\n' },
    { path: 'licenses/WNDB_License.txt', content: 'Princeton WordNet 3.1 license text\n' },
    { path: 'licenses/wordfreq-NOTICES.txt', content: 'wordfreq source notices\n' },
    { path: 'licenses/Leipzig-LICENSE.txt', content: 'Leipzig corpus license text\n' },
  ];
  const payloadBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: 1,
      language: 'en',
      version,
      files,
    }),
  );
  const compressedPayload = new Uint8Array(gzipSync(payloadBytes));
  const manifest = {
    id: 'lingo-palette-en-evidence',
    schemaVersion: 1,
    semanticVersion: version,
    language: 'en',
    minimumExtensionVersion: '0.0.0',
    compression: 'gzip',
    compressedSizeBytes: compressedPayload.byteLength,
    installedSizeBytes: payloadBytes.byteLength,
    payloadSha256: sha256(compressedPayload),
    contentIdentitySha256: sha256(payloadBytes),
    sources: [
      {
        id: 'oewn',
        version: '2025',
        asset: 'english-wordnet-2025-json.zip',
        sourceUrl:
          'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip',
        sha256: '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51',
        hashAuthority: 'publisher',
        changes: 'Redistributed unchanged test fixture data.',
      },
      {
        id: 'wordfreq',
        version: '3.1.1',
        asset: 'wordfreq-3.1.1-py3-none-any.whl',
        sourceUrl:
          'https://files.pythonhosted.org/packages/24/61/62835c475d69872d30689f284497853fe33fe1d6dd18f57346d13305861d/wordfreq-3.1.1-py3-none-any.whl',
        sha256: '4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473',
        hashAuthority: 'publisher',
        changes: 'Converted English test bins to TSV rows.',
      },
      {
        id: 'leipzig-eng-news',
        version: '2023-100K',
        asset: 'eng_news_2023_100K.tar.gz',
        sourceUrl:
          'https://downloads.wortschatz-leipzig.de/corpora/eng_news_2023_100K.tar.gz',
        sha256: '8e65ed5b9c96687d293374335c14dfb9db4c150877bcc208a21bcb2f86b43484',
        hashAuthority: 'locally-computed',
        changes: 'Extracted unchanged sentence test data.',
      },
    ],
    files: files.map((file) => ({
      path: file.path,
      byteSize: encoder.encode(file.content).byteLength,
      sha256: sha256(file.content),
    })),
    licenses: [
      {
        id: 'CC-BY-4.0',
        sourceIds: ['oewn'],
        filePaths: ['licenses/OEWN-2025-LICENSE.md'],
        attribution: 'Open English WordNet contributors',
      },
      {
        id: 'Princeton-WordNet-3.1',
        sourceIds: ['oewn'],
        filePaths: ['licenses/WNDB_License.txt'],
        attribution: 'Princeton University',
      },
      {
        id: 'wordfreq-notices',
        sourceIds: ['wordfreq'],
        filePaths: ['licenses/wordfreq-NOTICES.txt'],
        attribution: 'wordfreq and incorporated data sources',
      },
      {
        id: 'Leipzig-corpus',
        sourceIds: ['leipzig-eng-news'],
        filePaths: ['licenses/Leipzig-LICENSE.txt'],
        attribution: 'Leipzig Corpora Collection',
      },
    ],
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const { privateKey, publicKey } = keyPair ?? generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

  return {
    manifestBytes,
    signatureBytes: new Uint8Array(sign(null, manifestBytes, privateKey)),
    publicKeyBytes: new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32)),
    compressedPayload,
    privateKey,
    publicKey,
  };
}

function tamperFileWithoutUpdatingItsInventory(
  release: Awaited<ReturnType<typeof createSignedRelease>>,
) {
  const payload = evidencePackPayloadSchema.parse(
    JSON.parse(new TextDecoder().decode(gunzipSync(release.compressedPayload))),
  );
  const firstFile = payload.files[0];
  if (firstFile === undefined) throw new Error('Missing payload fixture.');
  firstFile.content = firstFile.content.replace('hold back', 'keep back');
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const compressedPayload = new Uint8Array(gzipSync(payloadBytes));
  const manifest = evidencePackManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(release.manifestBytes)),
  );
  manifest.compressedSizeBytes = compressedPayload.byteLength;
  manifest.installedSizeBytes = payloadBytes.byteLength;
  manifest.payloadSha256 = sha256(compressedPayload);
  manifest.contentIdentitySha256 = sha256(payloadBytes);
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  return {
    ...release,
    compressedPayload,
    manifestBytes,
    signatureBytes: new Uint8Array(
      sign(null, manifestBytes, release.privateKey),
    ),
  };
}

function mutateSignedManifest(
  release: Awaited<ReturnType<typeof createSignedRelease>>,
  mutate: (manifest: EvidencePackManifest) => void,
) {
  const manifest = evidencePackManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(release.manifestBytes)),
  );
  mutate(manifest);
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  return {
    ...release,
    manifestBytes,
    signatureBytes: new Uint8Array(
      sign(null, manifestBytes, release.privateKey),
    ),
  };
}

function replacePayload(
  release: Awaited<ReturnType<typeof createSignedRelease>>,
  payloadBytes: Uint8Array,
  updateContentIdentity = true,
) {
  const compressedPayload = new Uint8Array(gzipSync(payloadBytes));
  return mutateSignedManifest(
    { ...release, compressedPayload },
    (manifest) => {
      manifest.compressedSizeBytes = compressedPayload.byteLength;
      manifest.installedSizeBytes = payloadBytes.byteLength;
      manifest.payloadSha256 = sha256(compressedPayload);
      if (updateContentIdentity) {
        manifest.contentIdentitySha256 = sha256(payloadBytes);
      }
    },
  );
}
describe('Evidence Pack lifecycle', () => {
  it('stages a signed supported release, activates only after confirmation, and rolls back', async () => {
    const release = await createSignedRelease('2025.1.0');
    const storage = createMemoryStorage();
    const lifecycle = createEvidencePackLifecycle({
      extensionVersion: '0.0.0',
      now: () => '2026-08-14T12:00:00.000Z',
      signatureVerifier: createEd25519SignatureVerifier(release.publicKeyBytes),
      storage,
      supportedReleases: [
        { language: 'en', version: '2025.1.0' },
        { language: 'en', version: '2025.2.0' },
      ],
      transport: {
        async fetchAsset(_release, asset) {
          if (asset === 'manifest.json') return release.manifestBytes;
          if (asset === 'manifest.sig') return release.signatureBytes;
          return release.compressedPayload;
        },
      },
    });

    const inspection = await lifecycle.inspect({
      language: 'en',
      version: '2025.1.0',
    });

    expect(await lifecycle.loadActive()).toBeNull();
    expect(inspection).toMatchObject({
      status: 'awaiting-confirmation',
      language: 'en',
      version: '2025.1.0',
      compressedSizeBytes: release.compressedPayload.byteLength,
      installedSizeBytes: expect.any(Number),
      sourceCount: 3,
      attributions: [
        'Open English WordNet contributors',
        'Princeton University',
        'wordfreq and incorporated data sources',
        'Leipzig Corpora Collection',
      ],
    });
    expect((await lifecycle.snapshot()).activeVersion).toBeNull();

    await lifecycle.confirmActivation({ candidateId: inspection.candidateId });
    expect(await lifecycle.snapshot()).toMatchObject({
      activeVersion: '2025.1.0',
      rollbackVersion: null,
    });
    expect((await lifecycle.loadActive())?.manifest.semanticVersion).toBe(
      '2025.1.0',
    );

    const updateRelease = await createSignedRelease('2025.2.0', release);
    const updateLifecycle = createEvidencePackLifecycle({
      extensionVersion: '0.0.0',
      now: () => '2026-08-14T12:01:00.000Z',
      signatureVerifier: createEd25519SignatureVerifier(release.publicKeyBytes),
      storage,
      supportedReleases: [
        { language: 'en', version: '2025.1.0' },
        { language: 'en', version: '2025.2.0' },
      ],
      transport: {
        async fetchAsset(_release, asset) {
          if (asset === 'manifest.json') return updateRelease.manifestBytes;
          if (asset === 'manifest.sig') return updateRelease.signatureBytes;
          return updateRelease.compressedPayload;
        },
      },
    });
    const updateInspection = await updateLifecycle.inspect({
      language: 'en',
      version: '2025.2.0',
    });
    await updateLifecycle.confirmActivation({
      candidateId: updateInspection.candidateId,
    });

    expect(await updateLifecycle.snapshot()).toMatchObject({
      activeVersion: '2025.2.0',
      rollbackVersion: '2025.1.0',
      revalidationSweeps: [
        {
          fromEvidencePackVersion: '2025.1.0',
          toEvidencePackVersion: '2025.2.0',
          status: 'pending',
          execution: 'background-budgeted',
        },
      ],
    });

    await updateLifecycle.rollback();
    expect(await updateLifecycle.snapshot()).toMatchObject({
      activeVersion: '2025.1.0',
      rollbackVersion: '2025.2.0',
    });
  });

  it('queues bundled approvals when the first full Evidence Pack activates', async () => {
    const release = await createSignedRelease('2025.1.0');
    const storage = createMemoryStorage();
    const lifecycle = createEvidencePackLifecycle({
      extensionVersion: '0.0.0',
      fallbackEvidencePackVersion: '2025.1.0-minimal.1',
      now: () => '2026-08-14T12:00:00.000Z',
      signatureVerifier: createEd25519SignatureVerifier(release.publicKeyBytes),
      storage,
      transport: {
        async fetchAsset(_release, asset) {
          if (asset === 'manifest.json') return release.manifestBytes;
          if (asset === 'manifest.sig') return release.signatureBytes;
          return release.compressedPayload;
        },
      },
    });

    const inspection = await lifecycle.inspect({
      language: 'en',
      version: '2025.1.0',
    });
    await lifecycle.confirmActivation({ candidateId: inspection.candidateId });

    expect(await lifecycle.snapshot()).toMatchObject({
      activeVersion: '2025.1.0',
      rollbackVersion: '2025.1.0-minimal.1',
      revalidationSweeps: [
        {
          fromEvidencePackVersion: '2025.1.0-minimal.1',
          toEvidencePackVersion: '2025.1.0',
          status: 'pending',
          execution: 'background-budgeted',
        },
      ],
    });

    await lifecycle.rollback();
    expect(await lifecycle.snapshot()).toMatchObject({
      activeVersion: null,
      rollbackVersion: '2025.1.0',
      revalidationSweeps: [
        {
          fromEvidencePackVersion: '2025.1.0-minimal.1',
          toEvidencePackVersion: '2025.1.0',
        },
        {
          fromEvidencePackVersion: '2025.1.0',
          toEvidencePackVersion: '2025.1.0-minimal.1',
          status: 'pending',
        },
      ],
    });
  });

  it('rejects a file whose bytes do not match the signed inventory', async () => {
    const signedRelease = await createSignedRelease('2025.1.0');
    const release = tamperFileWithoutUpdatingItsInventory(signedRelease);
    const storage = createMemoryStorage();
    const lifecycle = createEvidencePackLifecycle({
      extensionVersion: '0.0.0',
      signatureVerifier: createEd25519SignatureVerifier(release.publicKeyBytes),
      storage,
      transport: {
        async fetchAsset(_release, asset) {
          if (asset === 'manifest.json') return release.manifestBytes;
          if (asset === 'manifest.sig') return release.signatureBytes;
          return release.compressedPayload;
        },
      },
    });

    await expect(
      lifecycle.inspect({ language: 'en', version: '2025.1.0' }),
    ).rejects.toMatchObject({ code: 'integrity-invalid' });
    expect(storage.staged.size).toBe(0);
    expect((await lifecycle.snapshot()).activeVersion).toBeNull();
  });

  it('rejects a signed manifest that changes a pinned source', async () => {
    const signedRelease = await createSignedRelease('2025.1.0');
    const release = mutateSignedManifest(signedRelease, (manifest) => {
      const leipzig = manifest.sources.find(
        (source) => source.id === 'leipzig-eng-news',
      );
      if (leipzig === undefined) throw new Error('Missing Leipzig fixture.');
      leipzig.sha256 = 'b'.repeat(64);
    });
    const storage = createMemoryStorage();
    const lifecycle = createEvidencePackLifecycle({
      extensionVersion: '0.0.0',
      signatureVerifier: createEd25519SignatureVerifier(release.publicKeyBytes),
      storage,
      transport: {
        async fetchAsset(_release, asset) {
          if (asset === 'manifest.json') return release.manifestBytes;
          if (asset === 'manifest.sig') return release.signatureBytes;
          return release.compressedPayload;
        },
      },
    });

    await expect(
      lifecycle.inspect({ language: 'en', version: '2025.1.0' }),
    ).rejects.toMatchObject({ code: 'manifest-invalid' });
    expect(storage.staged.size).toBe(0);
  });

  it.each([
    {
      field: 'compressedSizeBytes',
      invalidSize: MAX_EVIDENCE_PACK_COMPRESSED_BYTES + 1,
    },
    {
      field: 'installedSizeBytes',
      invalidSize: MAX_EVIDENCE_PACK_INSTALLED_BYTES + 1,
    },
  ] as const)('rejects a signed manifest above the $field cap', async ({
    field,
    invalidSize,
  }) => {
    const signedRelease = await createSignedRelease('2025.1.0');
    const release = mutateSignedManifest(signedRelease, (manifest) => {
      manifest[field] = invalidSize;
    });
    const storage = createMemoryStorage({
      version: 1,
      activeVersion: '2024.1.0',
      rollbackVersion: null,
      revalidationSweeps: [],
      installedCandidates: { '2024.1.0': 'c'.repeat(64) },
    });
    const lifecycle = createEvidencePackLifecycle({
      extensionVersion: '0.0.0',
      signatureVerifier: createEd25519SignatureVerifier(release.publicKeyBytes),
      storage,
      transport: {
        async fetchAsset(_release, asset) {
          if (asset === 'manifest.json') return release.manifestBytes;
          if (asset === 'manifest.sig') return release.signatureBytes;
          return release.compressedPayload;
        },
      },
    });

    await expect(
      lifecycle.inspect({ language: 'en', version: '2025.1.0' }),
    ).rejects.toMatchObject({ code: 'manifest-invalid' });
    expect(storage.staged.size).toBe(0);
    expect((await lifecycle.snapshot()).activeVersion).toBe('2024.1.0');
  });

  it('resumes bounded revalidation batches after restart without rewriting approved provenance', async () => {
    const sweep = {
      id: '2025.1.0->2025.2.0@2026-08-14T12:00:00.000Z',
      fromEvidencePackVersion: '2025.1.0',
      toEvidencePackVersion: '2025.2.0',
      status: 'pending' as const,
      execution: 'background-budgeted' as const,
      requestedAt: '2026-08-14T12:00:00.000Z',
      cursor: null,
      markedItemCount: 0,
      completedAt: null,
    };
    const storage = createMemoryStorage({
      version: 1,
      activeVersion: '2025.2.0',
      rollbackVersion: '2025.1.0',
      revalidationSweeps: [sweep],
      installedCandidates: {
        '2025.1.0': 'a'.repeat(64),
        '2025.2.0': 'b'.repeat(64),
      },
    });
    const approvedItems = [
      {
        id: 'review-c',
        provenance: { evidencePack: { version: '2025.1.0' }, pin: 'c' },
      },
      {
        id: 'review-a',
        provenance: { evidencePack: { version: '2025.1.0' }, pin: 'a' },
      },
      {
        id: 'review-b',
        provenance: { evidencePack: { version: '2025.1.0' }, pin: 'b' },
      },
    ];
    const originalApprovedItems = structuredClone(approvedItems);
    const markers = new Set<string>();
    const requestedLimits: number[] = [];
    const port = {
      async listApprovedByEvidencePack({
        evidencePackVersion,
        afterReviewItemId,
        limit,
      }: {
        evidencePackVersion: string;
        afterReviewItemId: string | null;
        limit: number;
      }) {
        requestedLimits.push(limit);
        const eligible = approvedItems
          .filter(
            (item) =>
              item.provenance.evidencePack.version === evidencePackVersion &&
              (afterReviewItemId === null || item.id > afterReviewItemId),
          )
          .map((item) => item.id)
          .sort();
        const reviewItemIds = eligible.slice(0, limit);
        return {
          reviewItemIds,
          nextCursor:
            eligible.length > reviewItemIds.length
              ? (reviewItemIds.at(-1) ?? null)
              : null,
        };
      },
      async markRevalidationPending(input: {
        reviewItemId: string;
        sweepId: string;
      }) {
        markers.add(`${input.sweepId}:${input.reviewItemId}`);
      },
    };
    const dependencies = {
      extensionVersion: '0.0.0',
      now: () => '2026-08-14T12:01:00.000Z',
      signatureVerifier: { async verify() { return true; } },
      storage,
      transport: {
        async fetchAsset() {
          throw new Error('not used');
        },
      },
    };

    const firstWorker = createEvidencePackLifecycle(dependencies);
    await expect(
      firstWorker.processNextRevalidationBatch(port, 2),
    ).resolves.toBe('pending');
    expect(markers.size).toBe(2);
    expect(await firstWorker.snapshot()).toMatchObject({
      revalidationSweeps: [
        { status: 'pending', cursor: 'review-b', markedItemCount: 2 },
      ],
    });

    const resumedWorker = createEvidencePackLifecycle(dependencies);
    await expect(
      resumedWorker.processNextRevalidationBatch(port, 2),
    ).resolves.toBe('completed');
    await expect(
      resumedWorker.processNextRevalidationBatch(port, 2),
    ).resolves.toBe('idle');
    expect(requestedLimits).toEqual([2, 2]);
    expect(markers.size).toBe(3);
    expect(approvedItems).toEqual(originalApprovedItems);
    expect(await resumedWorker.snapshot()).toMatchObject({
      revalidationSweeps: [
        {
          status: 'completed',
          cursor: null,
          markedItemCount: 3,
          completedAt: '2026-08-14T12:01:00.000Z',
        },
      ],
    });
  });

  it('keeps the queue pending when one completed sweep reveals another', async () => {
    const firstSweep = {
      id: 'first',
      fromEvidencePackVersion: '2025.1.0',
      toEvidencePackVersion: '2025.2.0',
      status: 'pending' as const,
      execution: 'background-budgeted' as const,
      requestedAt: '2026-08-14T12:00:00.000Z',
      cursor: null,
      markedItemCount: 0,
      completedAt: null,
    };
    const storage = createMemoryStorage({
      version: 1,
      activeVersion: '2025.3.0',
      rollbackVersion: '2025.2.0',
      revalidationSweeps: [
        firstSweep,
        {
          ...firstSweep,
          id: 'second',
          fromEvidencePackVersion: '2025.2.0',
          toEvidencePackVersion: '2025.3.0',
        },
      ],
      installedCandidates: {},
    });
    const lifecycle = createEvidencePackLifecycle({
      extensionVersion: '0.0.0',
      signatureVerifier: { async verify() { return true; } },
      storage,
      transport: {
        async fetchAsset() {
          throw new Error('not used');
        },
      },
    });
    const port = {
      async listApprovedByEvidencePack() {
        return { reviewItemIds: [], nextCursor: null };
      },
      async markRevalidationPending() {},
    };

    await expect(
      lifecycle.processNextRevalidationBatch(port),
    ).resolves.toBe('pending');
    expect((await lifecycle.snapshot()).revalidationSweeps).toMatchObject([
      { id: 'first', status: 'completed' },
      { id: 'second', status: 'pending' },
    ]);
  });

  it('preserves the active known-good pack across every staging and activation interruption', async () => {
    const phases = [
      'manifest-download',
      'signature-download',
      'signature-verification',
      'manifest-parse',
      'compatibility',
      'payload-download',
      'compressed-integrity',
      'decompression',
      'decompressed-size',
      'installed-identity',
      'payload-schema',
      'staging-write',
    ] as const;
    const knownGoodState: EvidencePackState = {
      version: 1,
      activeVersion: '2024.1.0',
      rollbackVersion: null,
      revalidationSweeps: [],
      installedCandidates: { '2024.1.0': 'c'.repeat(64) },
    };

    for (const phase of phases) {
      const baseRelease = await createSignedRelease('2025.1.0');
      let interruptedRelease = baseRelease;
      let failedAsset: EvidencePackAsset | null = null;
      if (phase === 'manifest-download') failedAsset = 'manifest.json';
      if (phase === 'signature-download') failedAsset = 'manifest.sig';
      if (phase === 'signature-verification') {
        interruptedRelease = {
          ...baseRelease,
          signatureBytes: new Uint8Array(64),
        };
      }
      if (phase === 'manifest-parse') {
        const manifestBytes = encoder.encode('{not-json');
        interruptedRelease = {
          ...baseRelease,
          manifestBytes,
          signatureBytes: new Uint8Array(
            sign(null, manifestBytes, baseRelease.privateKey),
          ),
        };
      }
      if (phase === 'compatibility') {
        interruptedRelease = mutateSignedManifest(
          baseRelease,
          (manifest) => {
            manifest.minimumExtensionVersion = '99.0.0';
          },
        );
      }
      if (phase === 'payload-download') {
        failedAsset = 'evidence-pack.json.gz';
      }
      if (phase === 'compressed-integrity') {
        const compressedPayload = baseRelease.compressedPayload.slice();
        const firstByte = compressedPayload[0];
        if (firstByte === undefined) throw new Error('Missing gzip fixture.');
        compressedPayload[0] = firstByte ^ 0xff;
        interruptedRelease = { ...baseRelease, compressedPayload };
      }
      if (phase === 'decompression') {
        const compressedPayload = encoder.encode('not a gzip package');
        interruptedRelease = mutateSignedManifest(
          { ...baseRelease, compressedPayload },
          (manifest) => {
            manifest.compressedSizeBytes = compressedPayload.byteLength;
            manifest.payloadSha256 = sha256(compressedPayload);
          },
        );
      }
      if (phase === 'decompressed-size') {
        interruptedRelease = mutateSignedManifest(
          baseRelease,
          (manifest) => {
            manifest.installedSizeBytes = 1;
          },
        );
      }
      if (phase === 'installed-identity') {
        const payloadBytes = new Uint8Array([
          ...gunzipSync(baseRelease.compressedPayload),
          0x20,
        ]);
        interruptedRelease = replacePayload(
          baseRelease,
          payloadBytes,
          false,
        );
      }
      if (phase === 'payload-schema') {
        interruptedRelease = replacePayload(
          baseRelease,
          encoder.encode(
            JSON.stringify({
              schemaVersion: 1,
              language: 'en',
              version: '2025.1.0',
              files: [{ path: 'sources/plugin.ts', content: 'run()' }],
            }),
          ),
        );
      }

      const storage = createMemoryStorage(knownGoodState);
      if (phase === 'staging-write') storage.failNextStage();
      const lifecycle = createEvidencePackLifecycle({
        extensionVersion: '0.0.0',
        signatureVerifier: createEd25519SignatureVerifier(
          baseRelease.publicKeyBytes,
        ),
        storage,
        transport: {
          async fetchAsset(_release, asset) {
            if (asset === failedAsset) {
              throw new Error(`simulated ${phase} interruption`);
            }
            if (asset === 'manifest.json') {
              return interruptedRelease.manifestBytes;
            }
            if (asset === 'manifest.sig') {
              return interruptedRelease.signatureBytes;
            }
            return interruptedRelease.compressedPayload;
          },
        },
      });

      await expect(
        lifecycle.inspect({ language: 'en', version: '2025.1.0' }),
        phase,
      ).rejects.toBeDefined();
      expect((await lifecycle.snapshot()).activeVersion, phase).toBe(
        '2024.1.0',
      );
      expect(storage.staged.size, phase).toBe(0);
    }

    const release = await createSignedRelease('2025.1.0');
    const storage = createMemoryStorage(knownGoodState);
    const lifecycle = createEvidencePackLifecycle({
      extensionVersion: '0.0.0',
      signatureVerifier: createEd25519SignatureVerifier(release.publicKeyBytes),
      storage,
      transport: {
        async fetchAsset(_release, asset) {
          if (asset === 'manifest.json') return release.manifestBytes;
          if (asset === 'manifest.sig') return release.signatureBytes;
          return release.compressedPayload;
        },
      },
    });
    const inspection = await lifecycle.inspect({
      language: 'en',
      version: '2025.1.0',
    });
    storage.failNextCommit();
    await expect(
      lifecycle.confirmActivation({ candidateId: inspection.candidateId }),
    ).rejects.toThrow('simulated activation interruption');
    expect((await lifecycle.snapshot()).activeVersion).toBe('2024.1.0');
  });
});
