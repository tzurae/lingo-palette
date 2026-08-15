import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createBrowserEvidencePackLifecycleStorage,
  type BrowserStorageArea,
} from './evidence-pack-browser-adapters';
import {
  MAX_EVIDENCE_PACK_COMPRESSED_BYTES,
  MAX_EVIDENCE_PACK_INSTALLED_BYTES,
  SUPPORTED_EVIDENCE_PACK_RELEASES,
} from './evidence-pack-catalog';
import {
  createEd25519SignatureVerifier,
  createEvidencePackLifecycle,
  packagedEvidenceSignatureVerifier,
} from './evidence-pack-lifecycle';

const release = SUPPORTED_EVIDENCE_PACK_RELEASES[0];
if (release === undefined) throw new Error('Missing supported release fixture.');
const releaseDirectory = join(
  process.cwd(),
  '.evidence-pack-dist',
  release.language,
  release.version,
);

function createStorageArea(): BrowserStorageArea {
  const values: Record<string, unknown> = {};
  return {
    async get(key) {
      return { [key]: structuredClone(values[key]) };
    },
    async set(items) {
      Object.assign(values, structuredClone(items));
    },
  };
}

describe.skipIf(!existsSync(releaseDirectory))(
  'built English Evidence Pack',
  () => {
    it(
      'test-installs the signed data-only package and recovers it after suspension',
      async () => {
        const assets = {
          'manifest.json': new Uint8Array(
            await readFile(join(releaseDirectory, 'manifest.json')),
          ),
          'manifest.sig': new Uint8Array(
            await readFile(join(releaseDirectory, 'manifest.sig')),
          ),
          'evidence-pack.json.gz': new Uint8Array(
            await readFile(join(releaseDirectory, 'evidence-pack.json.gz')),
          ),
        };
        const storageArea = createStorageArea();
        const storage =
          createBrowserEvidencePackLifecycleStorage(storageArea);
        const dependencies = {
          extensionVersion: '0.0.0',
          signatureVerifier: signatureVerifierForBuild(),
          storage,
          transport: {
            async fetchAsset(
              _requestedRelease: typeof release,
              asset: keyof typeof assets,
            ) {
              return assets[asset];
            },
          },
        };
        const lifecycle = createEvidencePackLifecycle(dependencies);

        const inspection = await lifecycle.inspect(release);
        expect(inspection).toMatchObject({
          status: 'awaiting-confirmation',
          sourceCount: 3,
          version: '2025.1.0',
        });
        expect(inspection.compressedSizeBytes).toBeLessThanOrEqual(
          MAX_EVIDENCE_PACK_COMPRESSED_BYTES,
        );
        expect(inspection.installedSizeBytes).toBeLessThanOrEqual(
          MAX_EVIDENCE_PACK_INSTALLED_BYTES,
        );
        expect(await lifecycle.loadActive()).toBeNull();

        await lifecycle.confirmActivation({
          candidateId: inspection.candidateId,
        });
        const resumedLifecycle = createEvidencePackLifecycle(dependencies);
        const active = await resumedLifecycle.loadActive();
        expect(active?.manifest.sources.map((source) => source.id)).toEqual([
          'oewn',
          'wordfreq',
          'leipzig-eng-news',
        ]);
        expect(active?.payload.files).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: 'sources/wordfreq/en.tsv' }),
            expect.objectContaining({ path: 'licenses/Apache-2.0.txt' }),
            expect.objectContaining({ path: 'licenses/CC-BY-4.0.txt' }),
            expect.objectContaining({ path: 'licenses/CC-BY-SA-4.0.txt' }),
            expect.objectContaining({ path: 'licenses/WNDB_License.txt' }),
            expect.objectContaining({ path: 'licenses/wordfreq-METADATA.txt' }),
          ]),
        );
        expect(
          active?.payload.files.every(
            (file) =>
              /^(?:sources|licenses)\//.test(file.path) &&
              !/(?:prompt|template|instruction|migration|executable)|\.(?:html?|js|wasm|exe)$/i.test(
                file.path,
              ),
          ),
        ).toBe(true);
        const contentAt = (path: string) =>
          active?.payload.files.find((file) => file.path === path)?.content;
        expect(contentAt('licenses/Apache-2.0.txt')).toContain(
          'Apache License',
        );
        expect(contentAt('licenses/CC-BY-SA-4.0.txt')).toContain(
          'Attribution-ShareAlike 4.0 International',
        );
        expect(contentAt('licenses/WNDB_License.txt')).toContain('WordNet');
        expect(contentAt('licenses/wordfreq-METADATA.txt')).toContain(
          'SUBTLEX',
        );
      },
      60_000,
    );
  },
);


function signatureVerifierForBuild() {
  const validationPublicKey =
    process.env.EVIDENCE_PACK_VALIDATION_PUBLIC_KEY_BASE64;
  return validationPublicKey === undefined
    ? packagedEvidenceSignatureVerifier()
    : createEd25519SignatureVerifier(
        new Uint8Array(Buffer.from(validationPublicKey, 'base64')),
      );
}