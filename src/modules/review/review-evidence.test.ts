import { describe, expect, it } from 'vitest';
import {
  calibrationFor,
  reviewEvidenceSchema,
  transitionReviewSchedule,
  type ObjectiveReviewEvidence,
  type ReviewEvidence,
  type ReviewScheduleState,
  type RetrievalFluency,
  type ReviewJudgment,
} from './review-evidence';

const ATTEMPTED_AT = '2026-08-15T12:00:00.000Z';

function schedule(
  intervalStage: number,
  dueAt = '2026-08-15T00:00:00.000Z',
): ReviewScheduleState {
  return { intervalStage, dueAt, demonstratedCount: 2 };
}

function objective(
  retrievalFluency: RetrievalFluency,
  judgment: ReviewJudgment,
  index: number,
): ObjectiveReviewEvidence {
  return {
    version: 1,
    id: `evidence-${index}`,
    learningItemId: 'learning-1',
    reviewItemId: 'review-1',
    sessionId: `session-${index}`,
    knowledgeDimension: 'contextual-meaning',
    recordedAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    kind: 'objective',
    responseMethod: 'overt-response',
    retrievalFluency,
    responseText: `response-${index}`,
    judgment,
  };
}

function selfAssessed(index: number): ReviewEvidence {
  return {
    version: 1,
    id: `evidence-${index}`,
    learningItemId: 'learning-1',
    reviewItemId: 'review-1',
    sessionId: `session-${index}`,
    knowledgeDimension: 'contextual-meaning',
    recordedAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    kind: 'self-assessed',
    responseMethod: 'covert-recall',
    retrievalFluency: 'recalled-fluently',
  };
}

describe('Review Evidence transitions', () => {
  it.each([
    ['objective demonstrated', schedule(0), { kind: 'objective', judgment: 'demonstrated' }, 1, '2026-08-18T12:00:00.000Z', 3],
    ['objective acceptable alternative', schedule(4), { kind: 'objective', judgment: 'acceptable-alternative' }, 3, '2026-08-29T12:00:00.000Z', 2],
    ['objective partial', schedule(2), { kind: 'objective', judgment: 'partial' }, 1, '2026-08-18T12:00:00.000Z', 2],
    ['objective not demonstrated', schedule(7), { kind: 'objective', judgment: 'not-demonstrated' }, 0, '2026-08-16T12:00:00.000Z', 2],
    ['objective unable to grade', schedule(5, '2026-10-01T00:00:00.000Z'), { kind: 'objective', judgment: 'unable-to-grade' }, 5, '2026-10-01T00:00:00.000Z', 2],
    ['self assessed fluent', schedule(4), { kind: 'self-assessed', retrievalFluency: 'recalled-fluently' }, 4, '2026-09-14T12:00:00.000Z', 2],
    ['self assessed with effort', schedule(4), { kind: 'self-assessed', retrievalFluency: 'recalled-with-effort' }, 3, '2026-08-29T12:00:00.000Z', 2],
    ['self assessed did not recall', schedule(6), { kind: 'self-assessed', retrievalFluency: 'did-not-recall' }, 0, '2026-08-16T12:00:00.000Z', 2],
    ['maintenance demonstrated', schedule(8), { kind: 'objective', judgment: 'demonstrated' }, 8, '2027-08-15T12:00:00.000Z', 3],
    ['maintenance acceptable alternative', schedule(8), { kind: 'objective', judgment: 'acceptable-alternative' }, 7, '2027-02-11T12:00:00.000Z', 2],
    ['maintenance fluent', schedule(8), { kind: 'self-assessed', retrievalFluency: 'recalled-fluently' }, 8, '2027-08-15T12:00:00.000Z', 2],
    ['maintenance effort', schedule(8), { kind: 'self-assessed', retrievalFluency: 'recalled-with-effort' }, 7, '2027-02-11T12:00:00.000Z', 2],
  ] as const)(
    '%s follows the inspectable interval ladder',
    (_name, current, outcome, expectedStage, expectedDueAt, expectedCount) => {
      expect(
        transitionReviewSchedule(current, outcome, ATTEMPTED_AT),
      ).toMatchObject({
        previous: current,
        next: {
          intervalStage: expectedStage,
          dueAt: expectedDueAt,
          demonstratedCount: expectedCount,
        },
      });
    },
  );

  it('selects objective calibration first and after three self-assessments', () => {
    expect(calibrationFor([])).toEqual({
      cadence: 'three-to-one',
      nextAttempt: 'objective',
      selfAssessmentsSinceObjective: 0,
    });

    const evidence: ReviewEvidence[] = [
      objective('recalled-with-effort', 'demonstrated', 0),
      selfAssessed(1),
      selfAssessed(2),
    ];
    expect(calibrationFor(evidence)).toMatchObject({
      cadence: 'three-to-one',
      nextAttempt: 'self-assessed',
      selfAssessmentsSinceObjective: 2,
    });
    expect(calibrationFor([...evidence, selfAssessed(3)])).toMatchObject({
      cadence: 'three-to-one',
      nextAttempt: 'objective',
      selfAssessmentsSinceObjective: 3,
    });
  });

  it('enters objective-only after two mismatches in three gradable pairs and restores after two matches', () => {
    const mismatchPairs: ReviewEvidence[] = [
      objective('recalled-fluently', 'partial', 0),
      objective('recalled-with-effort', 'not-demonstrated', 1),
      objective('did-not-recall', 'demonstrated', 2),
    ];
    expect(calibrationFor(mismatchPairs)).toMatchObject({
      cadence: 'objective-only',
      nextAttempt: 'objective',
    });

    const unable = objective('recalled-fluently', 'unable-to-grade', 3);
    expect(calibrationFor([...mismatchPairs, unable])).toMatchObject({
      cadence: 'objective-only',
      nextAttempt: 'objective',
    });

    const firstMatch = objective('recalled-with-effort', 'partial', 4);
    expect(calibrationFor([...mismatchPairs, unable, firstMatch])).toMatchObject({
      cadence: 'objective-only',
      nextAttempt: 'objective',
    });

    const secondMatch = objective('recalled-fluently', 'demonstrated', 5);
    expect(
      calibrationFor([
        ...mismatchPairs,
        unable,
        firstMatch,
        secondMatch,
      ]),
    ).toMatchObject({
      cadence: 'three-to-one',
      nextAttempt: 'self-assessed',
      selfAssessmentsSinceObjective: 0,
    });
  });

  it('requires dimension-matched, authoritative provenance for version 2 evidence', () => {
    const versionedEvidence = {
      version: 2,
      id: 'evidence-usage',
      learningItemId: 'learning-usage',
      reviewItemId: 'review-usage',
      sessionId: 'session-usage',
      knowledgeDimension: 'usage-fit',
      recordedAt: ATTEMPTED_AT,
      sourceAuthority: {
        knowledgeDimension: 'usage-fit',
        evidence: [
          {
            evidenceId: 'usage-fit-1',
            sourceId: 'oewn',
            sourceVersion: '2025',
            authority: 'sense-context',
          },
        ],
      },
      kind: 'objective',
      responseMethod: 'overt-response',
      retrievalFluency: 'recalled-fluently',
      responseText: 'postponed',
      judgment: 'demonstrated',
    } as const;

    expect(reviewEvidenceSchema.safeParse(versionedEvidence).success).toBe(true);
    expect(
      reviewEvidenceSchema.safeParse({
        ...versionedEvidence,
        sourceAuthority: {
          ...versionedEvidence.sourceAuthority,
          knowledgeDimension: 'grammar-pattern',
        },
      }).success,
    ).toBe(false);
    expect(
      reviewEvidenceSchema.safeParse({
        ...versionedEvidence,
        knowledgeDimension: 'grammar-pattern',
        sourceAuthority: {
          knowledgeDimension: 'grammar-pattern',
          evidence: [
            {
              evidenceId: 'grammar-corpus-1',
              sourceId: 'leipzig-eng-news',
              sourceVersion: '2023',
              authority: 'pos-aware-corpus-attestation',
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
