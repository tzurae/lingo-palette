import { z } from 'zod';
import type {
  EvidencePackManifest,
  CollocationEvidence,
  LicenseAndAttribution,
  PinnedEnglishEvidencePack,
  ReviewAuthorityEvidence,
} from '../evidence/bundled-english-evidence-pack';
import { sensePinSchema, type SensePin } from '../learning/sense-pin';
import {
  codePointLength,
  CONTEXT_LIMIT,
  SELECTION_LIMIT,
  type Selection,
} from '../reading-flow/selection';
import { selectionSchema } from '../reading-flow/selection-parser';
import { normalizeReviewAnswer } from './review-evidence';
import {
  reviewSourceAuthoritySchema,
  type MeasuredReviewKnowledgeDimension,
  type ReviewSourceAuthority,
} from './review-source-authority';
export type {
  MeasuredReviewKnowledgeDimension,
  ReviewSourceAuthority,
} from './review-source-authority';

const boundedText = (limit: number) =>
  z
    .string()
    .refine(
      (value) => value.trim().length > 0 && codePointLength(value) <= limit,
    );
const reviewText = boundedText(SELECTION_LIMIT);
const contextQuote = boundedText(SELECTION_LIMIT + CONTEXT_LIMIT * 2);
const learningItemSchema = z
  .object({
    id: reviewText,
    expression: reviewText,
    normalizedExpression: reviewText,
    status: z.literal('active'),
    sensePin: sensePinSchema.nullable(),
    productiveUseIntent: z.boolean().optional(),
  });
const encounterSchema = z
  .object({
    id: reviewText,
    learningItemId: reviewText,
    selection: selectionSchema,
    sensePin: sensePinSchema.nullable(),
  });
const generationSchema = z
  .object({ model: reviewText, promptVersion: reviewText })
  .strict();
const candidateBaseShape = {
  type: z.literal('contrastive'),
  learningItemId: reviewText,
  encounterId: reviewText,
  prompt: reviewText,
  contextQuote,
  acceptedAnswers: z.array(reviewText).min(1).max(12),
  distractors: z.array(reviewText).min(1).max(8),
  correctiveExplanation: reviewText,
};
const contextualMeaningCandidateSchema = z
  .object({
    ...candidateBaseShape,
    knowledgeDimension: z.literal('contextual-meaning'),
  })
  .strict();
const usageFitCandidateSchema = z
  .object({
    ...candidateBaseShape,
    knowledgeDimension: z.literal('usage-fit'),
    claimedFit: z.enum(['fits', 'does-not-fit']),
  })
  .strict();
const grammarPatternCandidateSchema = z
  .object({
    ...candidateBaseShape,
    knowledgeDimension: z.literal('grammar-pattern'),
    claimedPattern: reviewText,
    claimScope: z.enum(['observed', 'universal']),
  })
  .strict();
const collocationCandidateSchema = z
  .object({
    ...candidateBaseShape,
    knowledgeDimension: z.literal('collocation'),
    claimedCollocate: reviewText,
  })
  .strict();
const productiveUseCandidateSchema = z
  .object({
    type: z.literal('productive'),
    learningItemId: reviewText,
    encounterId: reviewText,
    knowledgeDimension: z.literal('productive-use'),
    prompt: reviewText,
    contextQuote,
    acceptedAnswers: z.array(reviewText).min(1).max(12),
    correctiveExplanation: reviewText,
  })
  .strict();
const reviewCandidateSchema = z.discriminatedUnion('knowledgeDimension', [
  contextualMeaningCandidateSchema,
  usageFitCandidateSchema,
  grammarPatternCandidateSchema,
  collocationCandidateSchema,
  productiveUseCandidateSchema,
]);
const criterionSchema = z.enum(['pass', 'fail', 'unknown']);
const evaluationSchema = z
  .object({
    grounding: criterionSchema,
    answerability: criterionSchema,
    linguisticAccuracy: criterionSchema,
    constructValidity: criterionSchema,
    distractorSafety: criterionSchema,
    correctiveExplanation: criterionSchema,
    validAlternativeAnswers: z.array(reviewText).max(12),
    partialAnswers: z.array(reviewText).max(12),
    evidenceAssessments: z
      .array(
        z
          .object({
            evidenceId: reviewText,
            relation: z.enum(['supports', 'contradicts', 'unknown']),
          })
          .strict(),
      )
      .max(24),
  })
  .strict()
  .superRefine((evaluation, context) => {
    const seen = new Set<string>();
    for (const [index, assessment] of evaluation.evidenceAssessments.entries()) {
      if (seen.has(assessment.evidenceId)) {
        context.addIssue({
          code: 'custom',
          path: ['evidenceAssessments', index, 'evidenceId'],
          message: 'Evidence assessments must identify each source once.',
        });
      }
      seen.add(assessment.evidenceId);
    }
  });

export const reviewGenerationContextSchema = z
  .object({
    learningItem: learningItemSchema,
    encounters: z.array(encounterSchema).min(1).max(5),
    generation: generationSchema,
  })
  .strict();
const reviewGenerationInputSchema = reviewGenerationContextSchema.extend({
  candidate: reviewCandidateSchema,
});

export type ContextualMeaningReviewCandidate = z.infer<
  typeof contextualMeaningCandidateSchema
>;
export type UsageFitReviewCandidate = z.infer<typeof usageFitCandidateSchema>;
export type GrammarPatternReviewCandidate = z.infer<
  typeof grammarPatternCandidateSchema
>;
export type CollocationReviewCandidate = z.infer<
  typeof collocationCandidateSchema
>;
export type ProductiveUseReviewCandidate = z.infer<
  typeof productiveUseCandidateSchema
>;
export type ReviewCandidate = z.infer<typeof reviewCandidateSchema>;
export type ReviewGenerationPin = z.infer<typeof generationSchema>;
export type ReviewGenerationInput = z.infer<typeof reviewGenerationInputSchema>;
export type ReviewGenerationContext = z.infer<
  typeof reviewGenerationContextSchema
>;

export function parseReviewCandidate(value: unknown): ReviewCandidate {
  return reviewCandidateSchema.parse(value);
}

export function parseControlledEvaluation(
  value: unknown,
): ControlledEvaluation {
  return evaluationSchema.parse(value);
}

export type ControlledEvaluation = z.infer<typeof evaluationSchema>;
export type ControlledReviewEvaluator = {
  evaluate(input: {
    learningItem: ReviewGenerationInput['learningItem'];
    encounter: ReviewGenerationInput['encounters'][number];
    candidate: ReviewCandidate;
    evidence: readonly ReviewAuthorityEvidence[];
  }): Promise<unknown>;
};

export type ApprovedReviewTask =
  | {
      type: 'contrastive';
      prompt: string;
      contextQuote: string;
      targetAnswers: string[];
      acceptableAlternativeAnswers: string[];
      partialAnswers: string[];
      distractors: string[];
      correctiveExplanation: string;
    }
  | {
      type: 'recall' | 'productive';
      prompt: string;
      contextQuote: string;
      targetAnswers: string[];
      acceptableAlternativeAnswers: string[];
      partialAnswers: string[];
      correctiveExplanation: string;
    };

type ApprovedReviewItemBase = {
  version: 1;
  id: string;
  learningItemId: string;
  provenance: {
    approvedAt: string;
    generation: { model: string; promptVersion: string };
    validatorVersion: string;
    evidencePack: EvidencePackManifest;
    relevantEvidence: ReviewAuthorityEvidence[];
    sourceAuthority?: ReviewSourceAuthority;
    licenseAndAttribution: readonly LicenseAndAttribution[];
    validation: {
      outcome: 'approved' | 'safe-fallback';
      reasons: string[];
    };
  };
};
type ReceptiveKnowledgeDimension = Exclude<
  MeasuredReviewKnowledgeDimension,
  'productive-use'
>;
export type ApprovedReviewItem = ApprovedReviewItemBase &
  (
    | {
        knowledgeDimension: 'productive-use';
        task: ApprovedReviewTask & { type: 'productive' };
      }
    | {
        knowledgeDimension: ReceptiveKnowledgeDimension;
        task: ApprovedReviewTask & { type: 'recall' | 'contrastive' };
      }
  );

export type ReviewGenerationResult =
  | { status: 'approved'; item: ApprovedReviewItem }
  | {
      status: 'rejected';
      reason:
        | 'invalid-input'
        | 'not-grounded'
        | 'evidence-unavailable'
        | 'evaluation-failed'
        | 'candidate-unsafe'
        | 'source-conflict';
    };

export function createReviewGenerationHarness(dependencies: {
  evidencePack: PinnedEnglishEvidencePack;
  evaluator: ControlledReviewEvaluator;
  validatorVersion: string;
  id?: () => string;
  now?: () => string;
}): {
  isReusable(
    item: ApprovedReviewItem,
    generation: ReviewGenerationPin,
  ): Promise<boolean>;
  review(input: ReviewGenerationInput): Promise<ReviewGenerationResult>;
} {
  const validatorVersion = reviewText.parse(dependencies.validatorVersion);
  const id = dependencies.id ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date().toISOString());
  const evidencePack = immutableSnapshot(dependencies.evidencePack);
  const evidencePackIntegrity = verifyEvidencePackIntegrity(evidencePack);

  return {
    async isReusable(item, generation) {
      const parsedGeneration = generationSchema.safeParse(generation);
      return (
        (await evidencePackIntegrity) &&
        parsedGeneration.success &&
        item.provenance.generation.model === parsedGeneration.data.model &&
        item.provenance.generation.promptVersion ===
          parsedGeneration.data.promptVersion &&
        item.provenance.validatorVersion === validatorVersion &&
        authorityPinsRelevantEvidence(item) &&
        sameEvidencePackManifest(
          item.provenance.evidencePack,
          evidencePack.manifest,
        )
      );
    },
    async review(input) {
      const parsed = reviewGenerationInputSchema.safeParse(input);
      if (!parsed.success) return { status: 'rejected', reason: 'invalid-input' };
      if (!(await evidencePackIntegrity)) {
        return { status: 'rejected', reason: 'evidence-unavailable' };
      }

      const { learningItem, encounters, generation, candidate } =
        immutableSnapshot(parsed.data);
      if (
        candidate.learningItemId !== learningItem.id ||
        learningItem.sensePin === null
      ) {
        return { status: 'rejected', reason: 'not-grounded' };
      }
      if (
        candidate.knowledgeDimension === 'productive-use' &&
        !learningItem.productiveUseIntent
      ) {
        return { status: 'rejected', reason: 'not-grounded' };
      }
      const sensePin = learningItem.sensePin;
      const encounter = encounters.find(
        (value) =>
          value.id === candidate.encounterId &&
          value.learningItemId === learningItem.id &&
          sameSensePin(value.sensePin, sensePin),
      );
      if (encounter === undefined) {
        return { status: 'rejected', reason: 'not-grounded' };
      }
      if (
        !contextQuoteSpansSelection(
          encounter.selection,
          candidate.contextQuote,
        )
      ) {
        return { status: 'rejected', reason: 'not-grounded' };
      }

      const evidence = Object.freeze(
        evidenceForCandidate(
          evidencePack,
          candidate,
          sensePin,
          learningItem.normalizedExpression,
        ),
      );
      if (evidence.length === 0) {
        return { status: 'rejected', reason: 'evidence-unavailable' };
      }

      let evaluated: unknown;
      try {
        evaluated = await dependencies.evaluator.evaluate({
          learningItem,
          encounter,
          candidate,
          evidence,
        });
      } catch {
        return { status: 'rejected', reason: 'evaluation-failed' };
      }
      const evaluation = evaluationSchema.safeParse(evaluated);
      if (!evaluation.success) {
        return { status: 'rejected', reason: 'evaluation-failed' };
      }
      const coreCriteria = [
        evaluation.data.grounding,
        evaluation.data.answerability,
        evaluation.data.linguisticAccuracy,
        evaluation.data.constructValidity,
        evaluation.data.correctiveExplanation,
      ];
      if (coreCriteria.some((criterion) => criterion !== 'pass')) {
        return { status: 'rejected', reason: 'candidate-unsafe' };
      }
      const authoritativeEvidence = evidence.filter((entry) =>
        isAuthoritativeForCandidate(candidate, entry, evidence),
      );
      if (authoritativeEvidence.length === 0) {
        return { status: 'rejected', reason: 'evidence-unavailable' };
      }
      const relationByEvidenceId = new Map(
        evaluation.data.evidenceAssessments.map((assessment) => [
          assessment.evidenceId,
          assessment.relation,
        ]),
      );
      const authorityRelations = authoritativeEvidence.map(
        (entry) => relationByEvidenceId.get(entry.id) ?? 'unknown',
      );
      if (authorityRelations.includes('contradicts')) {
        return { status: 'rejected', reason: 'source-conflict' };
      }
      const supportedEvidence = authoritativeEvidence.filter(
        (entry) => relationByEvidenceId.get(entry.id) === 'supports',
      );
      const relevantEvidence = sufficientSupportedAuthority(
        candidate,
        supportedEvidence,
      );
      if (relevantEvidence.length === 0) {
        return { status: 'rejected', reason: 'evidence-unavailable' };
      }
      const fallbackEvidence = relevantEvidence[0];
      if (fallbackEvidence === undefined) {
        return { status: 'rejected', reason: 'evidence-unavailable' };
      }
      const licenseAndAttribution = resolveLicenseAndAttribution(
        evidencePack,
        relevantEvidence,
      );
      if (licenseAndAttribution === null) {
        return { status: 'rejected', reason: 'evidence-unavailable' };
      }

      const targetAnswers = uniqueText(candidate.acceptedAnswers);
      const targetKeys = new Set(targetAnswers.map(normalizedText));
      const acceptableAlternativeAnswers = uniqueText(
        evaluation.data.validAlternativeAnswers,
      ).filter((answer) => !targetKeys.has(normalizedText(answer)));
      const acceptedKeys = new Set([
        ...targetKeys,
        ...acceptableAlternativeAnswers.map(normalizedText),
      ]);
      const partialAnswers = uniqueText(
        evaluation.data.partialAnswers,
      ).filter((answer) => !acceptedKeys.has(normalizedText(answer)));
      const answerKeys = new Set([
        ...acceptedKeys,
        ...partialAnswers.map(normalizedText),
      ]);
      const distractors =
        candidate.knowledgeDimension === 'productive-use'
          ? []
          : candidate.distractors;
      const hiddenValidAlternative = distractors.some((distractor) =>
        answerKeys.has(normalizedText(distractor)),
      );
      const fallbackReasons =
        candidate.knowledgeDimension === 'productive-use'
          ? []
          : [
              ...(hiddenValidAlternative ? ['hidden-valid-alternative'] : []),
              ...(evaluation.data.distractorSafety === 'pass'
                ? []
                : ['unsafe-distractor']),
            ];
      const approvedDimension =
        candidate.knowledgeDimension === 'productive-use'
          ? {
              knowledgeDimension: candidate.knowledgeDimension,
              task: {
                type: 'productive' as const,
                prompt: candidate.prompt,
                contextQuote: candidate.contextQuote,
                targetAnswers,
                acceptableAlternativeAnswers,
                partialAnswers,
                correctiveExplanation: candidate.correctiveExplanation,
              },
            }
          : {
              knowledgeDimension: candidate.knowledgeDimension,
              task:
                fallbackReasons.length === 0
                  ? {
                      type: 'contrastive' as const,
                      prompt: candidate.prompt,
                      contextQuote: candidate.contextQuote,
                      targetAnswers,
                      acceptableAlternativeAnswers,
                      partialAnswers,
                      distractors: uniqueText(distractors),
                      correctiveExplanation: candidate.correctiveExplanation,
                    }
                  : {
                      type: 'recall' as const,
                      prompt:
                        candidate.knowledgeDimension === 'contextual-meaning'
                          ? `What does “${learningItem.expression}” mean in this context?`
                          : candidate.prompt,
                      contextQuote: candidate.contextQuote,
                      targetAnswers,
                      acceptableAlternativeAnswers,
                      partialAnswers,
                      correctiveExplanation: fallbackCorrectiveExplanation(
                        candidate,
                        learningItem.expression,
                        fallbackEvidence,
                      ),
                    },
            };

      return {
        status: 'approved',
        item: {
          version: 1,
          id: id(),
          learningItemId: learningItem.id,
          ...approvedDimension,
          provenance: {
            approvedAt: now(),
            generation,
            validatorVersion,
            evidencePack: structuredClone(evidencePack.manifest),
            relevantEvidence: structuredClone(relevantEvidence),
            sourceAuthority: reviewSourceAuthoritySchema.parse({
              knowledgeDimension: candidate.knowledgeDimension,
              evidence: relevantEvidence.map((entry) => ({
                evidenceId: entry.id,
                sourceId: entry.sourceId,
                sourceVersion: entry.sourceVersion,
                authority: entry.authority,
              })),
            }),
            licenseAndAttribution: structuredClone(licenseAndAttribution),
            validation: {
              outcome:
                fallbackReasons.length === 0 ? 'approved' : 'safe-fallback',
              reasons: fallbackReasons,
            },
          },
        },
      };
    },
  };
}

function authorityPinsRelevantEvidence(item: ApprovedReviewItem): boolean {
  if (item.provenance.sourceAuthority === undefined) {
    return item.knowledgeDimension === 'contextual-meaning';
  }
  const parsed = reviewSourceAuthoritySchema.safeParse(
    item.provenance.sourceAuthority,
  );
  if (
    !parsed.success ||
    parsed.data.knowledgeDimension !== item.knowledgeDimension
  ) {
    return false;
  }
  return parsed.data.evidence.every((authority) =>
    item.provenance.relevantEvidence.some(
      (evidence) =>
        evidence.id === authority.evidenceId &&
        evidence.sourceId === authority.sourceId &&
        evidence.sourceVersion === authority.sourceVersion &&
        evidence.authority === authority.authority,
    ),
  );
}

function sameSensePin(
  left: SensePin | null,
  right: SensePin,
): boolean {
  return (
    left !== null &&
    left.evidencePackVersion === right.evidencePackVersion &&
    left.sourceSenseId === right.sourceSenseId &&
    left.morphology === right.morphology &&
    left.partOfSpeech === right.partOfSpeech
  );
}

function evidenceForCandidate(
  evidencePack: PinnedEnglishEvidencePack,
  candidate: ReviewCandidate,
  sensePin: SensePin,
  normalizedExpression: string,
): ReviewAuthorityEvidence[] {
  if (evidencePack.manifest.version !== sensePin.evidencePackVersion) return [];
  if (candidate.knowledgeDimension === 'contextual-meaning') {
    return evidencePack.contextualMeanings.filter(
      (entry) =>
        entry.sourceSenseId === sensePin.sourceSenseId &&
        entry.partOfSpeech === sensePin.partOfSpeech,
    );
  }
  if (candidate.knowledgeDimension === 'usage-fit') {
    return evidencePack.usageFits.filter(
      (entry) =>
        entry.sourceSenseId === sensePin.sourceSenseId &&
        entry.partOfSpeech === sensePin.partOfSpeech &&
        entry.morphology === sensePin.morphology &&
        normalizedText(entry.contextQuote) ===
          normalizedText(candidate.contextQuote) &&
        entry.fit === candidate.claimedFit,
    );
  }
  if (candidate.knowledgeDimension === 'collocation') {
    return evidencePack.collocations.filter(
      (entry) =>
        entry.authority === 'corpus-collocation' &&
        normalizedText(entry.targetExpression) ===
          normalizedText(normalizedExpression) &&
        normalizedText(entry.collocate) ===
          normalizedText(candidate.claimedCollocate) &&
        entry.partOfSpeech === sensePin.partOfSpeech &&
        entry.targetMorphologies.includes(sensePin.morphology) &&
        Number.isInteger(entry.rawCount) &&
        entry.rawCount >= 5 &&
        Number.isInteger(entry.minimumRawCount) &&
        entry.minimumRawCount >= 5 &&
        entry.rawCount >= entry.minimumRawCount &&
        entry.association.metric === 'log-likelihood' &&
        Number.isFinite(entry.association.value) &&
        entry.association.value > 0 &&
        hasDocumentedCorpus(entry) &&
        entry.window.type === 'same-sentence' &&
        sameSentenceContainsCollocation(
          candidate.contextQuote,
          entry.targetExpression,
          entry.collocate,
        ),
    );
  }
  if (candidate.knowledgeDimension === 'productive-use') {
    return evidencePack.contextualMeanings.filter(
      (entry) =>
        entry.sourceSenseId === sensePin.sourceSenseId &&
        entry.partOfSpeech === sensePin.partOfSpeech,
    );
  }
  return evidencePack.grammarPatterns.filter(
    (entry) =>
      entry.sourceSenseId === sensePin.sourceSenseId &&
      entry.partOfSpeech === sensePin.partOfSpeech &&
      entry.morphologies.includes(sensePin.morphology) &&
      normalizedText(entry.pattern) ===
        normalizedText(candidate.claimedPattern),
  );
}

function isAuthoritativeForCandidate(
  candidate: ReviewCandidate,
  evidence: ReviewAuthorityEvidence,
  matchingEvidence: readonly ReviewAuthorityEvidence[],
): boolean {
  if (candidate.knowledgeDimension === 'contextual-meaning') {
    return evidence.authority === 'primary-lexical';
  }
  if (candidate.knowledgeDimension === 'usage-fit') {
    return evidence.authority === 'sense-context';
  }
  if (candidate.knowledgeDimension === 'collocation') {
    return evidence.authority === 'corpus-collocation';
  }
  if (candidate.knowledgeDimension === 'productive-use') {
    return evidence.authority === 'primary-lexical';
  }
  if (candidate.claimScope === 'universal') return false;
  if (
    evidence.authority === 'source-recorded-frame' ||
    evidence.authority === 'source-recorded-usage-note'
  ) {
    return true;
  }
  return (
    evidence.authority === 'pos-aware-corpus-attestation' &&
    matchingEvidence.filter(
      (entry) => entry.authority === 'pos-aware-corpus-attestation',
    ).length >= 2
  );
}
function sufficientSupportedAuthority(
  candidate: ReviewCandidate,
  evidence: readonly ReviewAuthorityEvidence[],
): ReviewAuthorityEvidence[] {
  if (candidate.knowledgeDimension === 'contextual-meaning') {
    return evidence.filter((entry) => entry.authority === 'primary-lexical');
  }
  if (candidate.knowledgeDimension === 'usage-fit') {
    return evidence.filter((entry) => entry.authority === 'sense-context');
  }
  if (candidate.knowledgeDimension === 'collocation') {
    return evidence.filter(
      (entry) => entry.authority === 'corpus-collocation',
    );
  }
  if (candidate.knowledgeDimension === 'productive-use') {
    return evidence.filter((entry) => entry.authority === 'primary-lexical');
  }
  if (candidate.claimScope === 'universal') return [];
  const sourceRecorded = evidence.filter(
    (entry) =>
      entry.authority === 'source-recorded-frame' ||
      entry.authority === 'source-recorded-usage-note',
  );
  if (sourceRecorded.length > 0) return sourceRecorded;
  const corpus = evidence.filter(
    (entry) => entry.authority === 'pos-aware-corpus-attestation',
  );
  return corpus.length >= 2 ? corpus : [];
}

function fallbackCorrectiveExplanation(
  candidate: ReviewCandidate,
  expression: string,
  evidence: ReviewAuthorityEvidence,
): string {
  return candidate.knowledgeDimension === 'contextual-meaning' &&
    'definition' in evidence
    ? `Here, “${expression}” means “${evidence.definition}”.`
    : candidate.correctiveExplanation;
}

function uniqueText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizedText(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contextQuoteSpansSelection(
  selection: Selection,
  contextQuote: string,
): boolean {
  const encounterContext = `${selection.context.before}${selection.text}${selection.context.after}`;
  const selectionStart = selection.context.before.length;
  const selectionEnd = selectionStart + selection.text.length;
  let quoteStart = encounterContext.indexOf(contextQuote);
  while (quoteStart !== -1) {
    const quoteEnd = quoteStart + contextQuote.length;
    if (quoteStart <= selectionStart && quoteEnd >= selectionEnd) return true;
    quoteStart = encounterContext.indexOf(contextQuote, quoteStart + 1);
  }
  return false;
}

function normalizedText(value: string): string {
  return normalizeReviewAnswer(value);
}

function hasDocumentedCorpus(evidence: CollocationEvidence): boolean {
  if (
    normalizedText(evidence.corpus.name).length === 0 ||
    evidence.corpus.language !== 'en' ||
    !Number.isInteger(evidence.corpus.sentenceCount) ||
    evidence.corpus.sentenceCount <= 0 ||
    !Number.isInteger(evidence.corpus.tokenCount) ||
    evidence.corpus.tokenCount < evidence.corpus.sentenceCount
  ) {
    return false;
  }
  try {
    const source = new URL(evidence.corpus.sourceUrl);
    return (
      source.protocol === 'https:' &&
      source.username === '' &&
      source.password === ''
    );
  } catch {
    return false;
  }
}

function sameSentenceContainsCollocation(
  context: string,
  targetExpression: string,
  collocate: string,
): boolean {
  const targetTokens = normalizedTokens(targetExpression);
  const collocateTokens = normalizedTokens(collocate);
  if (targetTokens.length === 0 || collocateTokens.length === 0) return false;
  return context.split(/[.!?]+/u).some((sentence) => {
    const sentenceTokens = normalizedTokens(sentence);
    return (
      containsTokenSequence(sentenceTokens, targetTokens) &&
      containsTokenSequence(sentenceTokens, collocateTokens)
    );
  });
}

function normalizedTokens(value: string): string[] {
  return (
    normalizedText(value).match(
      /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu,
    ) ?? []
  );
}

function containsTokenSequence(
  source: readonly string[],
  target: readonly string[],
): boolean {
  return source.some((_, index) =>
    target.every((token, offset) => source[index + offset] === token),
  );
}

function sameEvidencePackManifest(
  left: EvidencePackManifest,
  right: EvidencePackManifest,
): boolean {
  return (
    left.id === right.id &&
    left.schemaVersion === right.schemaVersion &&
    left.version === right.version &&
    left.language === right.language &&
    left.minimumExtensionVersion === right.minimumExtensionVersion &&
    left.compression === right.compression &&
    left.compressedSizeBytes === right.compressedSizeBytes &&
    left.installedSizeBytes === right.installedSizeBytes &&
    left.contentIdentitySha256 === right.contentIdentitySha256 &&
    sameOrderedEntries(
      left.contentHashes,
      right.contentHashes,
      (entry, other) =>
        entry.path === other.path &&
        entry.byteSize === other.byteSize &&
        entry.sha256 === other.sha256,
    ) &&
    sameOrderedEntries(
      left.licenses,
      right.licenses,
      (entry, other) =>
        entry.id === other.id &&
        entry.path === other.path &&
        entry.byteSize === other.byteSize &&
        entry.sha256 === other.sha256,
    ) &&
    sameOrderedEntries(
      left.sources,
      right.sources,
      (source, other) =>
        source.id === other.id &&
        source.version === other.version &&
        source.asset === other.asset &&
        source.sha256 === other.sha256 &&
        sameOrderedEntries(
          source.licenseIds,
          other.licenseIds,
          (licenseId, otherLicenseId) => licenseId === otherLicenseId,
        ),
    )
  );
}

function sameOrderedEntries<T>(
  left: readonly T[],
  right: readonly T[],
  equals: (left: T, right: T) => boolean,
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return other !== undefined && equals(entry, other);
    })
  );
}

function immutableSnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
  return value;
}

async function verifyEvidencePackIntegrity(
  evidencePack: PinnedEnglishEvidencePack,
): Promise<boolean> {
  try {
    if (
      evidencePack.licenses.length !== evidencePack.manifest.licenses.length ||
      new Set(evidencePack.licenses.map((license) => license.id)).size !==
        evidencePack.licenses.length ||
      new Set(
        evidencePack.manifest.licenses.map((license) => license.id),
      ).size !== evidencePack.manifest.licenses.length ||
      !evidencePack.manifest.licenses.every((manifestLicense) => {
        const contentHash = evidencePack.manifest.contentHashes.find(
          (entry) => entry.path === manifestLicense.path,
        );
        return (
          contentHash !== undefined &&
          contentHash.byteSize === manifestLicense.byteSize &&
          contentHash.sha256 === manifestLicense.sha256
        );
      })
    ) {
      return false;
    }
    const files = [
      {
        path: 'contextual-meanings.json',
        content: JSON.stringify(evidencePack.contextualMeanings),
      },
      {
        path: 'usage-fits.json',
        content: JSON.stringify(evidencePack.usageFits),
      },
      {
        path: 'grammar-patterns.json',
        content: JSON.stringify(evidencePack.grammarPatterns),
      },
      {
        path: 'collocations.json',
        content: JSON.stringify(evidencePack.collocations),
      },
      {
        path: 'license-and-attribution.json',
        content: JSON.stringify(evidencePack.licenseAndAttribution),
      },
      ...evidencePack.manifest.licenses.map((manifestLicense) => {
        const license = evidencePack.licenses.find(
          (candidate) => candidate.id === manifestLicense.id,
        );
        return {
          path: manifestLicense.path,
          content: license?.text,
        };
      }),
    ];
    if (
      files.some((file) => file.content === undefined) ||
      new Set(files.map((file) => file.path)).size !== files.length ||
      new Set(
        evidencePack.manifest.contentHashes.map((entry) => entry.path),
      ).size !== evidencePack.manifest.contentHashes.length ||
      files.length !== evidencePack.manifest.contentHashes.length
    ) {
      return false;
    }

    const filesByPath = new Map(files.map((file) => [file.path, file.content]));
    let installedSizeBytes = 0;
    for (const expected of evidencePack.manifest.contentHashes) {
      const content = filesByPath.get(expected.path);
      if (content === undefined) return false;
      const encoded = new TextEncoder().encode(content);
      installedSizeBytes += encoded.byteLength;
      if (
        encoded.byteLength !== expected.byteSize ||
        (await sha256(encoded)) !== expected.sha256
      ) {
        return false;
      }
    }
    const encodedIdentity = new TextEncoder().encode(
      JSON.stringify(evidencePack.manifest.contentHashes),
    );
    return (
      installedSizeBytes === evidencePack.manifest.installedSizeBytes &&
      (await sha256(encodedIdentity)) ===
        evidencePack.manifest.contentIdentitySha256
    );
  } catch {
    return false;
  }
}

function resolveLicenseAndAttribution(
  evidencePack: PinnedEnglishEvidencePack,
  evidence: readonly ReviewAuthorityEvidence[],
): LicenseAndAttribution[] | null {
  const notices = new Map<string, LicenseAndAttribution>();
  for (const entry of evidence) {
    const notice = evidencePack.licenseAndAttribution.find(
      (candidate) =>
        candidate.sourceId === entry.sourceId &&
        candidate.sourceVersion === entry.sourceVersion,
    );
    if (
      notice === undefined ||
      !hasCompleteLicensePayload(evidencePack, notice)
    ) {
      return null;
    }
    notices.set(`${notice.sourceId}\u0000${notice.sourceVersion}`, notice);
  }
  return [...notices.values()];
}

function hasCompleteLicensePayload(
  evidencePack: PinnedEnglishEvidencePack,
  notice: LicenseAndAttribution,
): boolean {
  const manifestSource = evidencePack.manifest.sources.find(
    (source) =>
      source.id === notice.sourceId &&
      source.version === notice.sourceVersion,
  );
  if (
    notice.sourceName.trim().length === 0 ||
    notice.attribution.trim().length === 0 ||
    notice.notice.trim().length === 0 ||
    notice.licenseIdentifiers.length === 0 ||
    notice.licenseTextHashes.length !== notice.licenseIdentifiers.length ||
    new Set(notice.licenseIdentifiers).size !==
      notice.licenseIdentifiers.length ||
    notice.licenseUrls.length === 0 ||
    !notice.licenseUrls.every(isHttpsUrl) ||
    !isHttpsUrl(notice.sourceUrl) ||
    manifestSource === undefined ||
    !sameOrderedEntries(
      manifestSource.licenseIds,
      notice.licenseIdentifiers,
      (licenseId, noticeLicenseId) => licenseId === noticeLicenseId,
    )
  ) {
    return false;
  }
  return notice.licenseIdentifiers.every((licenseIdentifier) => {
    const expectedHash = notice.licenseTextHashes.find(
      (entry) => entry.licenseIdentifier === licenseIdentifier,
    )?.sha256;
    const manifestLicense = evidencePack.manifest.licenses.find(
      (entry) => entry.id === licenseIdentifier,
    );
    const bundledLicense = evidencePack.licenses.find(
      (entry) => entry.id === licenseIdentifier,
    );
    return (
      expectedHash !== undefined &&
      manifestLicense?.sha256 === expectedHash &&
      bundledLicense !== undefined
    );
  });
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function sha256(value: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
