import { describe, expect, it } from 'vitest';
import { verifyLocalLatencyEvidence } from './local-latency-evidence';

const operatingSystems = ['windows', 'macos'] as const;
const inputMethods = ['pointer', 'keyboard'] as const;
const readingSurfaces = ['top-level', 'same-origin-embedded'] as const;

function completeEvidence() {
  return {
    schemaVersion: 1,
    candidateCommit: 'a'.repeat(40),
    samples: operatingSystems.flatMap((os) =>
      inputMethods.flatMap((input) =>
        readingSurfaces.map((surface, index) => ({
          id: `${os}-${input}-${surface}`,
          measuredAt: '2026-08-24T16:00:00.000Z',
          os,
          input,
          surface,
          latencyMs: 80 + index,
        })),
      ),
    ),
  };
}

describe('local dogfood latency evidence', () => {
  it('passes all required OS, input, and reading-surface groups within budget', () => {
    const result = verifyLocalLatencyEvidence(completeEvidence(), 8);

    expect(result).toMatchObject({
      passed: true,
      candidateCommit: 'a'.repeat(40),
    });
    expect(result.groups).toHaveLength(8);
  });

  it('fails closed for incomplete coverage or any hard-budget breach', () => {
    const missing = completeEvidence();
    missing.samples = missing.samples.slice(1);
    const overP95 = completeEvidence();
    const overMaximum = completeEvidence();
    const firstP95Sample = overP95.samples[0];
    const firstMaximumSample = overMaximum.samples[0];
    if (firstP95Sample === undefined || firstMaximumSample === undefined) {
      throw new Error('Expected latency fixtures.');
    }
    firstP95Sample.latencyMs = 101;
    firstMaximumSample.latencyMs = 251;

    expect(
      verifyLocalLatencyEvidence(missing, missing.samples.length),
    ).toMatchObject({
      passed: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'missing-group' }),
      ]),
    });
    for (const evidence of [overP95, overMaximum]) {
      expect(verifyLocalLatencyEvidence(evidence, 8)).toMatchObject({
        passed: false,
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'budget-exceeded' }),
        ]),
      });
    }
    expect(verifyLocalLatencyEvidence(completeEvidence(), 9)).toMatchObject({
      passed: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'insufficient-sample-coverage' }),
      ]),
    });
  });
});
