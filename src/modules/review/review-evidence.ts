import { z } from 'zod';

export const retrievalFluencySchema = z.enum([
  'did-not-recall',
  'recalled-with-effort',
  'recalled-fluently',
]);
export const reviewJudgmentSchema = z.enum([
  'demonstrated',
  'acceptable-alternative',
  'partial',
  'not-demonstrated',
  'unable-to-grade',
]);

export function normalizeReviewAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLocaleLowerCase('en');
}

const evidenceBaseSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  learningItemId: z.string().min(1),
  reviewItemId: z.string().min(1),
  sessionId: z.string().min(1),
  knowledgeDimension: z.literal('contextual-meaning'),
  recordedAt: z.iso.datetime(),
});

export const reviewEvidenceSchema = z.discriminatedUnion('kind', [
  evidenceBaseSchema
    .extend({
      kind: z.literal('self-assessed'),
      responseMethod: z.literal('covert-recall'),
      retrievalFluency: retrievalFluencySchema,
    })
    .strict(),
  evidenceBaseSchema
    .extend({
      kind: z.literal('objective'),
      responseMethod: z.literal('overt-response'),
      retrievalFluency: retrievalFluencySchema,
      responseText: z.string().min(1),
      judgment: reviewJudgmentSchema,
    })
    .strict(),
]);

export type RetrievalFluency = z.infer<typeof retrievalFluencySchema>;
export type ReviewJudgment = z.infer<typeof reviewJudgmentSchema>;
export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
export type ObjectiveReviewEvidence = Extract<
  ReviewEvidence,
  { kind: 'objective' }
>;
export type ReviewScheduleState = Readonly<{
  intervalStage: number;
  dueAt: string;
  demonstratedCount: number;
}>;
export type ReviewScheduleTransition = Readonly<{
  previous: ReviewScheduleState;
  next: ReviewScheduleState;
}>;
export type ReviewOutcome =
  | Readonly<{
      kind: 'self-assessed';
      retrievalFluency: RetrievalFluency;
    }>
  | Readonly<{
      kind: 'objective';
      judgment: ReviewJudgment;
    }>;
export type ReviewCalibration = Readonly<{
  cadence: 'three-to-one' | 'objective-only';
  nextAttempt: 'self-assessed' | 'objective';
  selfAssessmentsSinceObjective: number;
}>;

const INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120, 180, 365] as const;
const MAINTENANCE_STAGE = INTERVAL_DAYS.length - 1;

export function transitionReviewSchedule(
  current: ReviewScheduleState,
  outcome: ReviewOutcome,
  attemptedAt: string,
): ReviewScheduleTransition {
  const previous: ReviewScheduleState = {
    intervalStage: current.intervalStage,
    dueAt: current.dueAt,
    demonstratedCount: current.demonstratedCount,
  };
  if (
    outcome.kind === 'objective' &&
    outcome.judgment === 'unable-to-grade'
  ) {
    return { previous, next: previous };
  }

  const nextStage = transitionStage(current.intervalStage, outcome);
  const nextCount =
    outcome.kind === 'objective' && outcome.judgment === 'demonstrated'
      ? current.demonstratedCount + 1
      : current.demonstratedCount;
  return {
    previous,
    next: {
      intervalStage: nextStage,
      dueAt: addDays(attemptedAt, INTERVAL_DAYS[nextStage]!),
      demonstratedCount: nextCount,
    },
  };
}

export function calibrationFor(
  evidence: readonly ReviewEvidence[],
): ReviewCalibration {
  let cadence: ReviewCalibration['cadence'] = 'three-to-one';
  let recentMismatches: boolean[] = [];
  let consecutiveMatches = 0;

  for (const record of evidence) {
    if (record.kind !== 'objective' || record.judgment === 'unable-to-grade') {
      continue;
    }
    const mismatch = isCalibrationMismatch(record);
    if (cadence === 'objective-only') {
      consecutiveMatches = mismatch ? 0 : consecutiveMatches + 1;
      if (consecutiveMatches >= 2) {
        cadence = 'three-to-one';
        recentMismatches = [];
        consecutiveMatches = 0;
      }
      continue;
    }

    recentMismatches = [...recentMismatches.slice(-2), mismatch];
    if (recentMismatches.filter(Boolean).length >= 2) {
      cadence = 'objective-only';
      consecutiveMatches = 0;
    }
  }

  const lastObjectiveIndex = evidence.findLastIndex(
    (record) => record.kind === 'objective',
  );
  const selfAssessmentsSinceObjective = evidence
    .slice(lastObjectiveIndex + 1)
    .filter((record) => record.kind === 'self-assessed').length;
  const hasObjective = lastObjectiveIndex >= 0;
  return {
    cadence,
    nextAttempt:
      cadence === 'objective-only' ||
      !hasObjective ||
      selfAssessmentsSinceObjective >= 3
        ? 'objective'
        : 'self-assessed',
    selfAssessmentsSinceObjective,
  };
}

function transitionStage(
  currentStage: number,
  outcome: ReviewOutcome,
): number {
  if (outcome.kind === 'self-assessed') {
    if (outcome.retrievalFluency === 'did-not-recall') return 0;
    if (outcome.retrievalFluency === 'recalled-with-effort') {
      return Math.max(0, currentStage - 1);
    }
    return currentStage;
  }
  if (outcome.judgment === 'not-demonstrated') return 0;
  if (
    outcome.judgment === 'acceptable-alternative' ||
    outcome.judgment === 'partial'
  ) {
    return Math.max(0, currentStage - 1);
  }
  return Math.min(MAINTENANCE_STAGE, currentStage + 1);
}

function isCalibrationMismatch(evidence: ObjectiveReviewEvidence): boolean {
  return (
    (evidence.retrievalFluency === 'recalled-fluently' &&
      evidence.judgment !== 'demonstrated') ||
    (evidence.retrievalFluency === 'did-not-recall' &&
      evidence.judgment === 'demonstrated')
  );
}

function addDays(instant: string, days: number): string {
  return new Date(Date.parse(instant) + days * 86_400_000).toISOString();
}
