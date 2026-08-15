import type { ProviderUsage } from '../openai/budget-ledger';
import type {
  ReviewCandidate,
  ReviewGenerationInput,
  ReviewGenerationResult,
} from './review-generation-harness';
import {
  ReviewPreparationFailure,
  type ReviewPreparationJob,
  type ReviewPreparationResult,
  type ReviewPreparationWorker,
} from './review-preparation-queue';

export type ReviewCandidateGenerator = {
  generate(job: ReviewPreparationJob): Promise<{
    candidate: ReviewCandidate;
    usage: ProviderUsage;
  }>;
};

export type PreparedReviewValidator = {
  review(request: {
    job: ReviewPreparationJob;
    input: ReviewGenerationInput;
  }): Promise<{
    result: ReviewGenerationResult;
    usage: ProviderUsage;
  }>;
};

export function createReviewPreparationWorker(dependencies: {
  candidateGenerator: ReviewCandidateGenerator;
  validator: PreparedReviewValidator;
}): ReviewPreparationWorker {
  return {
    async execute(job): Promise<ReviewPreparationResult> {
      const generated = await dependencies.candidateGenerator.generate(job);
      if (
        generated.candidate.learningItemId !== job.learningItemId ||
        generated.candidate.knowledgeDimension !==
          job.knowledgeDimension ||
        !job.context.encounters.some(
          (encounter) =>
            encounter.id === generated.candidate.encounterId,
        )
      ) {
        throw new ReviewPreparationFailure(
          'candidate-target-mismatch',
          false,
          { usage: generated.usage },
        );
      }
      let validated: Awaited<
        ReturnType<PreparedReviewValidator['review']>
      >;
      try {
        validated = await dependencies.validator.review({
          job,
          input: {
            ...job.context,
            candidate: generated.candidate,
          },
        });
      } catch (error) {
        if (error instanceof ReviewPreparationFailure) {
          throw new ReviewPreparationFailure(
            error.kind,
            error.retryable,
            {
              message: error.message,
              usage:
                error.usage === null
                  ? generated.usage
                  : addUsage(generated.usage, error.usage),
            },
          );
        }
        throw error;
      }
      const usage = addUsage(generated.usage, validated.usage);
      if (validated.result.status !== 'approved') {
        throw new ReviewPreparationFailure(
          validated.result.reason,
          false,
          { usage },
        );
      }
      return {
        item: validated.result.item,
        schedule: job.schedule,
        usage,
      };
    },
  };
}

function addUsage(
  left: ProviderUsage,
  right: ProviderUsage,
): ProviderUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens:
      left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens:
      left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    estimatedCostUsd:
      left.estimatedCostUsd === null ||
      right.estimatedCostUsd === null
        ? null
        : left.estimatedCostUsd + right.estimatedCostUsd,
  };
}
