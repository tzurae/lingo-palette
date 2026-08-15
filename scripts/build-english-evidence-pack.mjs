import { decode } from '@msgpack/msgpack';
import { gunzipSync, gzipSync, unzipSync } from 'fflate';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIRST_ENGLISH_EVIDENCE_SOURCES,
  MAX_EVIDENCE_PACK_COMPRESSED_BYTES,
  MAX_EVIDENCE_PACK_INSTALLED_BYTES,
  PACKAGED_EVIDENCE_PUBLIC_KEY_BASE64,
  SUPPORTED_EVIDENCE_PACK_RELEASES,
} from '../src/modules/evidence/evidence-pack-catalog.ts';
import { isEvidencePackDataPath } from '../src/modules/evidence/evidence-pack-schema.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const release = SUPPORTED_EVIDENCE_PACK_RELEASES[0];
if (release === undefined) throw new Error('No supported Evidence Pack release.');

const outputRoot = argumentValue('--output') ?? join(repositoryRoot, '.evidence-pack-dist');
const cacheRoot = argumentValue('--cache') ?? join(repositoryRoot, '.evidence-pack-cache');
const signingKeyPath = process.env.EVIDENCE_PACK_SIGNING_KEY_PATH;
const unsignedValidation =
  process.env.EVIDENCE_PACK_UNSIGNED_VALIDATION === 'true';
if (
  !unsignedValidation &&
  (signingKeyPath === undefined || signingKeyPath.length === 0)
) {
  throw new Error(
    'EVIDENCE_PACK_SIGNING_KEY_PATH must name the offline Ed25519 private key.',
  );
}
const expectedPublicKeyBase64 =
  process.env.EVIDENCE_PACK_VALIDATION_PUBLIC_KEY_BASE64 ??
  PACKAGED_EVIDENCE_PUBLIC_KEY_BASE64;

await mkdir(cacheRoot, { recursive: true });
const archives = new Map();
for (const source of FIRST_ENGLISH_EVIDENCE_SOURCES) {
  archives.set(source.id, await acquirePinnedSource(source));
}

const files = [];
appendOewnFiles(requiredArchive('oewn'));
appendWordfreqFiles(requiredArchive('wordfreq'));
appendLeipzigFiles(requiredArchive('leipzig-eng-news'));
await appendLicenseFiles();
files.sort((left, right) => left.path.localeCompare(right.path, 'en'));

const payload = {
  schemaVersion: 1,
  language: release.language,
  version: release.version,
  files,
};
const payloadBytes = encoder.encode(JSON.stringify(payload));
const compressedPayload = gzipSync(payloadBytes, { level: 9, mtime: 0 });
if (payloadBytes.byteLength > MAX_EVIDENCE_PACK_INSTALLED_BYTES) {
  throw new Error(`Installed pack exceeds ${MAX_EVIDENCE_PACK_INSTALLED_BYTES} bytes.`);
}
if (compressedPayload.byteLength > MAX_EVIDENCE_PACK_COMPRESSED_BYTES) {
  throw new Error(`Compressed pack exceeds ${MAX_EVIDENCE_PACK_COMPRESSED_BYTES} bytes.`);
}

const manifest = {
  id: 'lingo-palette-en-evidence',
  schemaVersion: 1,
  semanticVersion: release.version,
  language: release.language,
  minimumExtensionVersion: '0.0.0',
  compression: 'gzip',
  compressedSizeBytes: compressedPayload.byteLength,
  installedSizeBytes: payloadBytes.byteLength,
  payloadSha256: sha256(compressedPayload),
  contentIdentitySha256: sha256(payloadBytes),
  sources: FIRST_ENGLISH_EVIDENCE_SOURCES,
  files: files.map((file) => {
    const bytes = encoder.encode(file.content);
    return {
      path: file.path,
      byteSize: bytes.byteLength,
      sha256: sha256(bytes),
    };
  }),
  licenses: [
    {
      id: 'CC-BY-4.0',
      sourceIds: ['oewn', 'leipzig-eng-news'],
      filePaths: ['licenses/CC-BY-4.0.txt'],
      attribution:
        'Open English WordNet 2025 © 2019–present Open English WordNet contributors; Leipzig Corpora Collection eng_news_2023_100K.',
    },
    {
      id: 'Princeton-WordNet-3.1',
      sourceIds: ['oewn'],
      filePaths: [
        'licenses/OEWN-2025-LICENSE.md.txt',
        'licenses/WNDB_License.txt',
      ],
      attribution:
        'Open English WordNet is based on WordNet 3.1 © 2011 Princeton University.',
    },
    {
      id: 'Apache-2.0',
      sourceIds: ['wordfreq'],
      filePaths: ['licenses/Apache-2.0.txt'],
      attribution: 'wordfreq 3.1.1 © Robyn Speer and contributors.',
    },
    {
      id: 'CC-BY-SA-4.0-and-source-notices',
      sourceIds: ['wordfreq'],
      filePaths: [
        'licenses/CC-BY-SA-4.0.txt',
        'licenses/wordfreq-LICENSE.txt',
        'licenses/wordfreq-METADATA.txt',
      ],
      attribution:
        'wordfreq English data sources and SUBTLEX authors as enumerated in the complete packaged METADATA notices.',
    },
  ],
};
validateBuiltPackage(payload, manifest);
const manifestBytes = encoder.encode(JSON.stringify(manifest));
let signature = new Uint8Array();
if (!unsignedValidation) {
  const privateKey = createPrivateKey(await readFile(signingKeyPath));
  const publicKeyDer = createPublicKey(privateKey).export({
    type: 'spki',
    format: 'der',
  });
  const publicKeyRaw = publicKeyDer.subarray(publicKeyDer.length - 32);
  if (publicKeyRaw.toString('base64') !== expectedPublicKeyBase64) {
    throw new Error(
      'Signing key does not match the expected Evidence Pack public key.',
    );
  }
  signature = sign(null, manifestBytes, privateKey);
  if (!verify(null, manifestBytes, createPublicKey(privateKey), signature)) {
    throw new Error('Generated manifest signature did not verify.');
  }
}

const releaseDirectory = join(outputRoot, release.language, release.version);
await mkdir(releaseDirectory, { recursive: true });
await Promise.all([
  writeFile(join(releaseDirectory, 'manifest.json'), manifestBytes),
  writeFile(join(releaseDirectory, 'manifest.sig'), signature),
  writeFile(join(releaseDirectory, 'evidence-pack.json.gz'), compressedPayload),
]);

console.log(
  JSON.stringify({
    releaseDirectory,
    language: release.language,
    version: release.version,
    sourceCount: manifest.sources.length,
    fileCount: manifest.files.length,
    compressedSizeBytes: manifest.compressedSizeBytes,
    installedSizeBytes: manifest.installedSizeBytes,
    contentIdentitySha256: manifest.contentIdentitySha256,
    signed: !unsignedValidation,
  }),
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

async function acquirePinnedSource(source) {
  const cachePath = join(cacheRoot, source.asset);
  let bytes;
  try {
    if ((await stat(cachePath)).isFile()) bytes = new Uint8Array(await readFile(cachePath));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (bytes === undefined) {
    bytes = await fetchBounded(source.sourceUrl, 90_000_000);
    await writeFile(cachePath, bytes);
  }
  const digest = sha256(bytes);
  if (digest !== source.sha256) {
    throw new Error(`${source.asset} SHA-256 mismatch: expected ${source.sha256}, received ${digest}.`);
  }
  return bytes;
}

async function fetchBounded(url, maximumBytes) {
  const response = await fetch(url, {
    credentials: 'omit',
    redirect: 'follow',
  });
  if (!response.ok || response.body === null) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel();
      throw new Error(`${url} exceeds ${maximumBytes} bytes.`);
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
}

function requiredArchive(sourceId) {
  const archive = archives.get(sourceId);
  if (archive === undefined) throw new Error(`Missing acquired source ${sourceId}.`);
  return archive;
}

function appendOewnFiles(archive) {
  const entries = unzipSync(archive, {
    filter: (entry) => entry.name.endsWith('.json'),
  });
  for (const [path, bytes] of Object.entries(entries)) {
    if (!/^[A-Za-z0-9.-]+\.json$/.test(path)) {
      throw new Error(`Unexpected OEWN archive path: ${path}`);
    }
    files.push({ path: `sources/oewn/${path}`, content: decoder.decode(bytes) });
  }
  if (Object.keys(entries).length < 60) {
    throw new Error('OEWN archive is missing expected JSON data files.');
  }
}

function appendWordfreqFiles(archive) {
  const entries = unzipSync(archive, {
    filter: (entry) =>
      entry.name === 'wordfreq/data/large_en.msgpack.gz' ||
      entry.name === 'wordfreq-3.1.1.dist-info/LICENSE.txt' ||
      entry.name === 'wordfreq-3.1.1.dist-info/METADATA',
  });
  const encodedBins = entries['wordfreq/data/large_en.msgpack.gz'];
  if (encodedBins === undefined) throw new Error('wordfreq English data is missing.');
  const bins = decode(gunzipSync(encodedBins));
  if (
    !Array.isArray(bins) ||
    bins.length < 2 ||
    typeof bins[0] !== 'object' ||
    bins[0] === null ||
    bins[0].format !== 'cB' ||
    bins[0].version !== 1
  ) {
    throw new Error('wordfreq English cBpack header is invalid.');
  }
  const rows = ['word\tzipf'];
  for (let index = 1; index < bins.length; index += 1) {
    const bin = bins[index];
    if (!Array.isArray(bin) || !bin.every((word) => typeof word === 'string')) {
      throw new Error(`wordfreq cBpack bin ${index} is invalid.`);
    }
    const zipf = (9 - (index - 1) / 100).toFixed(2);
    for (const word of bin) {
      if (/\r|\n|\t/.test(word)) throw new Error('wordfreq token contains TSV control characters.');
      rows.push(`${word}\t${zipf}`);
    }
  }
  files.push({ path: 'sources/wordfreq/en.tsv', content: `${rows.join('\n')}\n` });
  const wheelLicense = entries['wordfreq-3.1.1.dist-info/LICENSE.txt'];
  const wheelMetadata = entries['wordfreq-3.1.1.dist-info/METADATA'];
  if (wheelLicense === undefined || wheelMetadata === undefined) {
    throw new Error('wordfreq wheel license or source notices are missing.');
  }
  files.push({ path: 'licenses/wordfreq-LICENSE.txt', content: decoder.decode(wheelLicense) });
  files.push({ path: 'licenses/wordfreq-METADATA.txt', content: decoder.decode(wheelMetadata) });
}

function appendLeipzigFiles(archive) {
  const tarEntries = parseTar(gunzipSync(archive));
  const corpusFiles = tarEntries.filter(
    (entry) =>
      entry.path.startsWith('eng_news_2023_100K/') &&
      entry.path.endsWith('.txt'),
  );
  if (corpusFiles.length < 8) {
    throw new Error('Leipzig corpus is missing expected text data files.');
  }
  for (const entry of corpusFiles) {
    files.push({
      path: `sources/leipzig/${basename(entry.path)}`,
      content: decoder.decode(entry.bytes),
    });
  }
}

async function appendLicenseFiles() {
  const names = [
    'Apache-2.0.txt',
    'CC-BY-4.0.txt',
    'CC-BY-SA-4.0.txt',
    'OEWN-2025-LICENSE.md.txt',
    'WNDB_License.txt',
  ];
  for (const name of names) {
    const content = await readFile(
      join(repositoryRoot, 'src/modules/evidence/licenses', name),
      'utf8',
    );
    files.push({ path: `licenses/${name}`, content });
  }
}

function parseTar(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const storedChecksum = parseTarOctal(header.subarray(148, 156));
    let checksum = 0;
    for (let index = 0; index < header.byteLength; index += 1) {
      checksum += index >= 148 && index < 156 ? 32 : header[index];
    }
    if (checksum !== storedChecksum) throw new Error('TAR header checksum mismatch.');
    const name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`Unsafe TAR path: ${path}`);
    }
    const size = parseTarOctal(header.subarray(124, 136));
    const type = header[156];
    offset += 512;
    if (offset + size > bytes.byteLength) throw new Error(`Truncated TAR entry: ${path}`);
    if (type === 0 || type === 48) {
      entries.push({ path, bytes: bytes.slice(offset, offset + size) });
    } else if (type !== 53) {
      throw new Error(`Unsupported TAR entry type ${type} at ${path}.`);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

function tarText(bytes) {
  const zero = bytes.indexOf(0);
  return decoder.decode(zero < 0 ? bytes : bytes.subarray(0, zero));
}

function parseTarOctal(bytes) {
  const text = tarText(bytes).trim();
  if (!/^[0-7]+$/.test(text)) throw new Error(`Invalid TAR octal value: ${text}`);
  return Number.parseInt(text, 8);
}

function validateBuiltPackage(payload, manifest) {
  if (
    payload.schemaVersion !== 1 ||
    payload.language !== release.language ||
    payload.version !== release.version ||
    payload.files.length < 1 ||
    payload.files.length > 256
  ) {
    throw new Error('Built Evidence Pack payload identity or file count is invalid.');
  }
  const paths = new Set();
  for (const file of payload.files) {
    if (
      typeof file.content !== 'string' ||
      !isEvidencePackDataPath(file.path) ||
      paths.has(file.path)
    ) {
      throw new Error(`Built Evidence Pack contains an unsafe or duplicate path: ${file.path}`);
    }
    paths.add(file.path);
  }
  if (
    manifest.id !== 'lingo-palette-en-evidence' ||
    manifest.schemaVersion !== 1 ||
    manifest.semanticVersion !== release.version ||
    manifest.language !== release.language ||
    manifest.sources.length !== FIRST_ENGLISH_EVIDENCE_SOURCES.length ||
    manifest.files.length !== payload.files.length
  ) {
    throw new Error('Built Evidence Pack manifest identity or inventory is invalid.');
  }
  for (const metadata of manifest.files) {
    const file = payload.files.find((candidate) => candidate.path === metadata.path);
    const bytes = file === undefined ? null : encoder.encode(file.content);
    if (
      bytes === null ||
      metadata.byteSize !== bytes.byteLength ||
      metadata.sha256 !== sha256(bytes)
    ) {
      throw new Error(`Built Evidence Pack file metadata mismatch: ${metadata.path}`);
    }
  }
  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  const licensedSourceIds = new Set();
  for (const license of manifest.licenses) {
    if (
      typeof license.attribution !== 'string' ||
      license.attribution.length === 0 ||
      license.filePaths.some((path) => !path.startsWith('licenses/') || !paths.has(path))
    ) {
      throw new Error(`Built Evidence Pack license payload is incomplete: ${license.id}`);
    }
    for (const sourceId of license.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        throw new Error(`Built Evidence Pack license refers to unknown source: ${sourceId}`);
      }
      licensedSourceIds.add(sourceId);
    }
  }
  for (const sourceId of sourceIds) {
    if (!licensedSourceIds.has(sourceId)) {
      throw new Error(`Built Evidence Pack source lacks license coverage: ${sourceId}`);
    }
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
