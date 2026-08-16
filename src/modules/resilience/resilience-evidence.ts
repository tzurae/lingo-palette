import { z } from 'zod';
import {
  RESILIENCE_MATRIX,
  RESILIENCE_PLAN_VERSION,
} from './resilience-matrix.ts';
import type {
  ResilienceEvidence,
  ResilienceEvidenceExpectation,
} from './resilience-matrix.ts';
import { RELEASE_PACKAGE_CHECK_IDS } from './release-package.ts';

const assertionSchema = z
  .object({
    title: z.string(),
    status: z.string(),
    failureMessages: z.array(z.string()).optional(),
  })
  .passthrough();
const vitestReportSchema = z
  .object({
    success: z.boolean().optional(),
    testResults: z.array(
      z
        .object({
          name: z.string(),
          status: z.string().optional(),
          assertionResults: z.array(assertionSchema),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const packageInspectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    checks: z.array(
      z
        .object({
          id: z.enum(RELEASE_PACKAGE_CHECK_IDS),
          status: z.enum(['passed', 'failed']),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type BuildResilienceEvidenceInput = {
  vitestReport: unknown;
  vitestArtifact: string;
  packageInspection: unknown;
  packageArtifact: string;
  runId: string;
  extensionCommit: string;
  recordedAt: string;
};

type EvidenceResult =
  ResilienceEvidence['rows'][number]['evidence'][number];

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeTitle(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201c\u201d'"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceMatches(actual: string, expected: string): boolean {
  const actualPath = normalizePath(actual);
  const expectedPath = normalizePath(expected);
  return (
    actualPath === expectedPath || actualPath.endsWith(`/${expectedPath}`)
  );
}

function buildVitestResult(
  expected: Extract<ResilienceEvidenceExpectation, { kind: 'vitest' }>,
  report: z.infer<typeof vitestReportSchema>,
  artifact: string,
): EvidenceResult {
  const suite = report.testResults.find((candidate) =>
    sourceMatches(candidate.name, expected.source),
  );
  const assertion = suite?.assertionResults.find(
    (candidate) =>
      normalizeTitle(candidate.title) === normalizeTitle(expected.testName),
  );
  return {
    ...expected,
    status: assertion?.status === 'passed' ? 'passed' : 'failed',
    artifact: `${artifact}#${expected.source}::${expected.testName}`,
  };
}

function buildPackageResult(
  expected: Extract<
    ResilienceEvidenceExpectation,
    { kind: 'package-inspection' }
  >,
  report: z.infer<typeof packageInspectionSchema>,
  artifact: string,
): EvidenceResult {
  const result = report.checks.find((candidate) => candidate.id === expected.id);
  return {
    ...expected,
    status: result?.status === 'passed' ? 'passed' : 'failed',
    artifact: `${artifact}#${expected.id}`,
  };
}

export function buildResilienceEvidence(
  input: BuildResilienceEvidenceInput,
): ResilienceEvidence {
  const vitestReport = vitestReportSchema.parse(input.vitestReport);
  const packageInspection = packageInspectionSchema.parse(
    input.packageInspection,
  );
  return {
    schemaVersion: 1,
    planVersion: RESILIENCE_PLAN_VERSION,
    runId: input.runId,
    extensionCommit: input.extensionCommit,
    recordedAt: input.recordedAt,
    rows: RESILIENCE_MATRIX.map((matrixRow) => {
      const evidence = matrixRow.evidence.map((expected) =>
        expected.kind === 'vitest'
          ? buildVitestResult(expected, vitestReport, input.vitestArtifact)
          : buildPackageResult(
              expected,
              packageInspection,
              input.packageArtifact,
            ),
      );
      return {
        ...matrixRow,
        outcome: evidence.every((result) => result.status === 'passed')
          ? 'passed'
          : 'failed',
        evidence,
      };
    }),
  };
}
