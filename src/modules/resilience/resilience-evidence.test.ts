import { describe, expect, it } from 'vitest';
import { buildResilienceEvidence } from './resilience-evidence';
import {
  RESILIENCE_MATRIX,
  verifyResilienceEvidence,
} from './resilience-matrix';
import { RELEASE_PACKAGE_CHECK_IDS } from './release-package';
import type { ReleasePackageInspection } from './release-package';

function passingVitestReport(): unknown {
  const bySource = new Map<
    string,
    Array<{ title: string; status: 'passed'; failureMessages: string[] }>
  >();
  for (const row of RESILIENCE_MATRIX) {
    for (const evidence of row.evidence) {
      if (evidence.kind !== 'vitest') continue;
      const assertions = bySource.get(evidence.source) ?? [];
      if (!assertions.some((assertion) => assertion.title === evidence.testName)) {
        assertions.push({
          title: evidence.testName,
          status: 'passed',
          failureMessages: [],
        });
      }
      bySource.set(evidence.source, assertions);
    }
  }
  return {
    success: true,
    testResults: Array.from(bySource, ([source, assertionResults]) => ({
      name: `C:/workspace/lingo-palette/${source}`,
      status: 'passed',
      assertionResults,
    })),
  };
}

function passingPackageInspection(): ReleasePackageInspection {
  return {
    schemaVersion: 1,
    checks: RELEASE_PACKAGE_CHECK_IDS.map((id) => ({
      id,
      status: 'passed',
      message: 'Passed built archive inspection.',
    })),
  };
}

describe('resilience evidence builder', () => {
  it('links every maintained row to passing regression and package evidence', () => {
    const evidence = buildResilienceEvidence({
      vitestReport: passingVitestReport(),
      vitestArtifact: '.resilience-results/vitest.json',
      packageInspection: passingPackageInspection(),
      packageArtifact: '.resilience-results/package.json',
      runId: 'resilience-run-1',
      extensionCommit: 'abc1234',
      recordedAt: '2026-08-16T17:00:00.000Z',
    });

    expect(verifyResilienceEvidence(evidence)).toEqual({
      passed: true,
      findings: [],
    });
    expect(evidence.rows).toHaveLength(RESILIENCE_MATRIX.length);
  });

  it('records a failed row when linked regression or package evidence is absent', () => {
    const report = passingVitestReport() as {
      testResults: Array<{ assertionResults: unknown[] }>;
    };
    report.testResults[0]?.assertionResults.shift();
    const packageInspection = passingPackageInspection();
    packageInspection.checks[0]!.status = 'failed';

    const evidence = buildResilienceEvidence({
      vitestReport: report,
      vitestArtifact: '.resilience-results/vitest.json',
      packageInspection,
      packageArtifact: '.resilience-results/package.json',
      runId: 'resilience-run-2',
      extensionCommit: 'def5678',
      recordedAt: '2026-08-16T17:01:00.000Z',
    });

    expect(verifyResilienceEvidence(evidence).passed).toBe(false);
    expect(evidence.rows.filter((row) => row.outcome === 'failed').length).toBeGreaterThanOrEqual(2);
  });
});
