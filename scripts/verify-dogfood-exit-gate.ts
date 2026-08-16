import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  evaluateDogfoodActivity,
  evaluateDogfoodExitGate,
  parseDogfoodExitAttestations,
} from '../src/modules/dogfood/exit-gate.ts';
import { inspectApprovedReviewSource } from '../src/modules/dogfood/approved-review-source.ts';
import { verifyLocalLatencyEvidence } from '../src/modules/dogfood/local-latency-evidence.ts';
import { renderDogfoodReleaseReport } from '../src/modules/dogfood/release-report.ts';
import { verifyResilienceEvidence } from '../src/modules/resilience/resilience-matrix.ts';
import {
  evaluateSmokeEvidence,
  mergeSmokeEvidence,
} from '../src/modules/smoke/smoke-evidence.ts';

const maximumEvidenceBytes = 50 * 1024 * 1024;
const maximumEvidenceBundleBytes = 300 * 1024 * 1024;
const measuredEvidenceFiles = new Map<string, number>();
let measuredEvidenceBytes = 0;
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateCommit: z.string().regex(/^[0-9a-f]{40}$/),
    activityArtifacts: z.array(z.string().min(1)),
    smokeArtifacts: z.array(z.string().min(1)).min(1),
    resilienceArtifact: z.string().min(1),
    attestationsArtifact: z.string().min(1),
    outputDirectory: z.string().min(1),
  })
  .strict();

const manifestArgument = process.argv[2];
const manifestPath = resolve(
  manifestArgument ?? '.dogfood-results/manifest.json',
);
const manifest = manifestSchema.parse(await readJson(manifestPath));
const manifestDirectory = dirname(manifestPath);
await accountEvidenceDirectory(manifestDirectory);
const requiredCandidateCommit = process.env.DOGFOOD_CANDIDATE_COMMIT;
if (
  requiredCandidateCommit !== undefined &&
  manifest.candidateCommit !== requiredCandidateCommit
) {
  throw new Error(
    `Evidence candidate ${manifest.candidateCommit} does not match checked-out candidate ${requiredCandidateCommit}.`,
  );
}
const resolveArtifact = (path: string): string =>
  resolveBundlePath(path, 'Evidence path');
const resolveOutputDirectory = (path: string): string =>
  resolveBundlePath(path, 'Output directory');
function resolveBundlePath(path: string, label: string): string {
  const resolved = resolve(manifestDirectory, path);
  const relativePath = relative(manifestDirectory, resolved);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes its evidence bundle: ${path}`);
  }
  return resolved;
}

const activity = await Promise.all(
  manifest.activityArtifacts.map((path) => readJson(resolveArtifact(path))),
);
const smokeRecords = await Promise.all(
  manifest.smokeArtifacts.map((path) => readJson(resolveArtifact(path))),
);
const smokeEvidence = mergeSmokeEvidence(smokeRecords);
const evaluatedSmoke = evaluateSmokeEvidence(smokeEvidence);
const smokeCandidateMatches = smokeEvidence.environments.every(
  (environment) =>
    environment.extensionCommit === manifest.candidateCommit,
);
const smoke = {
  ...evaluatedSmoke,
  passed: evaluatedSmoke.passed && smokeCandidateMatches,
  ...(smokeCandidateMatches
    ? {}
    : {
        message:
          'Supported Reading Surface evidence was recorded from a different candidate commit.',
      }),
};
const resilienceEvidence = await readJson(
  resolveArtifact(manifest.resilienceArtifact),
);
const evaluatedResilience = verifyResilienceEvidence(resilienceEvidence);
const resilienceCandidateMatches =
  z
    .object({ extensionCommit: z.string() })
    .passthrough()
    .safeParse(resilienceEvidence).data?.extensionCommit ===
  manifest.candidateCommit;
const resilience = {
  ...evaluatedResilience,
  passed: evaluatedResilience.passed && resilienceCandidateMatches,
  ...(resilienceCandidateMatches
    ? {}
    : {
        message:
          'Integrated resilience evidence was recorded from a different candidate commit.',
      }),
};
const attestations = await readJson(
  resolveArtifact(manifest.attestationsArtifact),
);
const approvedReviewArtifact = await verifyApprovedReviewArtifact(attestations);
const localLatency = await verifyLocalLatencyArtifact(
  attestations,
  evaluateDogfoodActivity(activity).summary.selectionCount,
);
const evidenceArtifacts = await verifyEvidenceArtifacts(attestations);
const result = evaluateDogfoodExitGate({
  candidateCommit: manifest.candidateCommit,
  activity,
  smoke,
  resilience,
  localLatency,
  evidenceArtifacts,
  approvedReviewArtifact,
  attestations,
});
const generatedAt = new Date().toISOString();
const outputDirectory = resolveOutputDirectory(manifest.outputDirectory);
const evidencePath = resolve(outputDirectory, 'release-evidence.json');
const reportPath = resolve(outputDirectory, 'release-evidence.html');
const evidence = {
  schemaVersion: 1,
  generatedAt,
  candidateCommit: manifest.candidateCommit,
  manifest: manifestPath,
  result,
};
const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
const reportText = renderDogfoodReleaseReport({
  generatedAt,
  candidateCommit: manifest.candidateCommit,
  result,
});
accountEvidenceFile(evidencePath, Buffer.byteLength(evidenceText));
accountEvidenceFile(reportPath, Buffer.byteLength(reportText));
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(evidencePath, evidenceText, 'utf8'),
  writeFile(reportPath, reportText, 'utf8'),
]);

console.log(
  JSON.stringify(
    {
      passed: result.passed,
      gates: result.gates.map(({ id, status }) => ({ id, status })),
      artifacts: { evidence: evidencePath, report: reportPath },
    },
    null,
    2,
  ),
);
if (!result.passed) process.exitCode = 1;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readEvidenceBytes(path)).toString('utf8')) as unknown;
}

async function readEvidenceBytes(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Evidence path is not a regular file: ${path}`);
  }
  if (metadata.size > maximumEvidenceBytes) {
    throw new Error(
      `${path} exceeds the ${maximumEvidenceBytes.toLocaleString('en-US')} byte evidence limit.`,
    );
  }
  accountEvidenceFile(path, metadata.size);
  return readFile(path);
}

async function verifyApprovedReviewArtifact(
  attestations: unknown,
): Promise<{
  passed: boolean;
  message?: string;
  latestItems?: readonly { id: string; sourceItemPath: string }[];
}> {
  let parsed: ReturnType<typeof parseDogfoodExitAttestations>;
  try {
    parsed = parseDogfoodExitAttestations(attestations);
  } catch {
    return { passed: true };
  }
  try {
    const sourcePath = resolveArtifact(
      parsed.approvedReviewAudit.sourceArtifact,
    );
    const bytes = await readEvidenceBytes(sourcePath);
    const latestItems = inspectApprovedReviewSource(
      JSON.parse(bytes.toString('utf8')) as unknown,
    );
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== parsed.approvedReviewAudit.inventoryDigest) {
      return {
        passed: false,
        message: `Approved Review Item source digest mismatch; expected ${parsed.approvedReviewAudit.inventoryDigest}, received ${digest}.`,
      };
    }
    return { passed: true, latestItems };
  } catch (error) {
    return {
      passed: false,
      message:
        error instanceof Error
          ? `Approved Review Item source is not valid inspectable JSON: ${error.message}`
          : 'Approved Review Item source is not valid inspectable JSON.',
    };
  }
}

async function verifyLocalLatencyArtifact(
  attestations: unknown,
  expectedSelectionCount: number,
): Promise<{
  passed: boolean;
  message?: string;
  findings: readonly unknown[];
}> {
  let parsed: ReturnType<typeof parseDogfoodExitAttestations>;
  try {
    parsed = parseDogfoodExitAttestations(attestations);
  } catch {
    return { passed: true, findings: [] };
  }
  try {
    const evidence = verifyLocalLatencyEvidence(
      await readJson(resolveArtifact(parsed.latency.localUiArtifact)),
      expectedSelectionCount,
    );
    if (evidence.candidateCommit !== manifest.candidateCommit) {
      return {
        passed: false,
        message:
          'Local latency evidence was recorded from a different candidate commit.',
        findings: evidence.findings,
      };
    }
    return {
      ...evidence,
      ...(evidence.passed
        ? {}
        : {
            message:
              evidence.findings[0]?.message ??
              'Local latency evidence did not pass.',
          }),
    };
  } catch (error) {
    return {
      passed: false,
      message:
        error instanceof Error
          ? `Local latency evidence is invalid: ${error.message}`
          : 'Local latency evidence is invalid.',
      findings: [],
    };
  }
}

async function verifyEvidenceArtifacts(
  attestations: unknown,
): Promise<{ passed: boolean; message?: string }> {
  let parsed: ReturnType<typeof parseDogfoodExitAttestations>;
  try {
    parsed = parseDogfoodExitAttestations(attestations);
  } catch {
    return { passed: true };
  }
  const references = [
    ...parsed.keyboardOnly.evidenceLinks,
    ...parsed.freshProfileRecovery.evidenceLinks,
    ...parsed.accessibility.flatMap((entry) => entry.evidenceLinks),
    parsed.latency.localUiArtifact,
    parsed.latency.providerArtifact,
    ...parsed.licenseProvenanceReview.evidenceLinks,
    ...parsed.evidenceSummaryLinks.map(({ artifact }) => artifact),
  ];
  try {
    for (const reference of new Set(references)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
        throw new Error(`Unsupported evidence link scheme: ${reference}`);
      }
      const artifactPath = resolveArtifact(reference);
      const metadata = await lstat(artifactPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`Evidence link is not a file: ${reference}`);
      }
      accountEvidenceFile(artifactPath, metadata.size);
    }
    return { passed: true };
  } catch (error) {
    return {
      passed: false,
      message:
        error instanceof Error
          ? `Release evidence link is invalid: ${error.message}`
          : 'Release evidence link is invalid.',
    };
  }
}

async function accountEvidenceDirectory(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await accountEvidenceDirectory(path);
    } else if (entry.isFile()) {
      accountEvidenceFile(path, (await lstat(path)).size);
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Evidence bundle contains a symbolic link: ${path}`);
    }
  }
}

function accountEvidenceFile(path: string, size: number): void {
  const previousSize = measuredEvidenceFiles.get(path) ?? 0;
  measuredEvidenceFiles.set(path, size);
  measuredEvidenceBytes += size - previousSize;
  if (measuredEvidenceBytes > maximumEvidenceBundleBytes) {
    throw new Error(
      `Release evidence exceeds the ${maximumEvidenceBundleBytes.toLocaleString('en-US')} byte pack limit.`,
    );
  }
}
