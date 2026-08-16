import { describe, expect, it } from 'vitest';
import {
  RESILIENCE_MATRIX,
  RESILIENCE_RISK_AREAS,
  verifyResilienceEvidence,
  type ResilienceEvidence,
} from './resilience-matrix';

function completeEvidence(): ResilienceEvidence {
  return {
    schemaVersion: 1,
    planVersion: '2026-08-16',
    runId: 'resilience-run-1',
    extensionCommit: 'abc1234',
    recordedAt: '2026-08-16T17:00:00.000Z',
    rows: RESILIENCE_MATRIX.map((row) => ({
      ...row,
      outcome: 'passed' as const,
      evidence: row.evidence.map((expected) => ({
        ...expected,
        status: 'passed' as const,
        artifact: `${expected.kind}:${expected.id}`,
      })),
    })),
  };
}

describe('integrated resilience and recovery matrix', () => {
  it('covers every release risk area with auditable recovery expectations', () => {
    expect(new Set(RESILIENCE_MATRIX.map((row) => row.riskArea))).toEqual(
      new Set(RESILIENCE_RISK_AREAS),
    );
    expect(new Set(RESILIENCE_MATRIX.map((row) => row.id)).size).toBe(
      RESILIENCE_MATRIX.length,
    );
    for (const row of RESILIENCE_MATRIX) {
      expect(row.setup).not.toHaveLength(0);
      expect(row.injectedFault).not.toHaveLength(0);
      expect(row.observableLearnerState).not.toHaveLength(0);
      expect(row.persistedAftermath).not.toHaveLength(0);
      expect(row.budgetEffect).not.toHaveLength(0);
      expect(row.recoveryAction).not.toHaveLength(0);
      expect(row.evidence.length).toBeGreaterThan(0);
    }
  });

  it('fails closed when a row, linked check, or passing outcome is missing', () => {
    const missingRow = completeEvidence();
    missingRow.rows.shift();
    expect(verifyResilienceEvidence(missingRow)).toMatchObject({
      passed: false,
      findings: [{ code: 'missing-row' }],
    });

    const missingCheck = completeEvidence();
    missingCheck.rows[0]?.evidence.shift();
    expect(verifyResilienceEvidence(missingCheck)).toMatchObject({
      passed: false,
      findings: [{ code: 'missing-evidence' }],
    });

    const failedRow = completeEvidence();
    if (failedRow.rows[0] !== undefined) failedRow.rows[0].outcome = 'failed';
    expect(verifyResilienceEvidence(failedRow)).toMatchObject({
      passed: false,
      findings: [{ code: 'row-failed' }],
    });
  });

  it('passes only a complete identical rerun of the maintained matrix', () => {
    expect(verifyResilienceEvidence(completeEvidence())).toEqual({
      passed: true,
      findings: [],
    });
  });
});
