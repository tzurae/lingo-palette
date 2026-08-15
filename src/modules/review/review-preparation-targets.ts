import type { LearningState } from '../learning/learning-item-store';
import type { OpenAiConfiguration } from '../openai/configuration-store';
import type { ApprovedReviewItem } from './review-generation-harness';
import type { ReviewSchedule } from './review-session-store';
import type { ReviewPreparationTarget } from './review-preparation-queue';
import type { MeasuredReviewKnowledgeDimension } from './review-source-authority';

export const REVIEW_PROMPT_VERSION = 'review-preparation-v1';

const receptiveDimensions = [
  'contextual-meaning',
  'usage-fit',
  'grammar-pattern',
  'collocation',
] as const satisfies readonly MeasuredReviewKnowledgeDimension[];

export function planReviewPreparationTargets(input: {
  learning: LearningState;
  approvedItems: readonly ApprovedReviewItem[];
  schedules: readonly ReviewSchedule[];
  configuration: OpenAiConfiguration;
}): ReviewPreparationTarget[] {
  const targets: ReviewPreparationTarget[] = [];
  for (const learningItem of input.learning.learningItems) {
    if (learningItem.status !== 'active') continue;
    const encounters = input.learning.encounters
      .filter(
        (encounter) => encounter.learningItemId === learningItem.id,
      )
      .slice(-5);
    if (encounters.length === 0) continue;
    const dimensions: readonly MeasuredReviewKnowledgeDimension[] =
      learningItem.productiveUseIntent === true
        ? [...receptiveDimensions, 'productive-use']
        : receptiveDimensions;
    for (const knowledgeDimension of dimensions) {
      const schedule = input.schedules.find(
        (candidate) =>
          candidate.learningItemId === learningItem.id &&
          candidate.knowledgeDimension === knowledgeDimension,
      );
      const approvals = input.approvedItems
        .filter(
          (candidate) =>
            candidate.learningItemId === learningItem.id &&
            candidate.knowledgeDimension === knowledgeDimension,
        )
        .sort(
          (left, right) =>
            right.provenance.approvedAt.localeCompare(
              left.provenance.approvedAt,
            ) || right.id.localeCompare(left.id),
        );
      targets.push({
        knowledgeDimension,
        schedule: {
          dueAt: schedule?.dueAt ?? learningItem.createdAt,
          demonstratedCount: schedule?.demonstratedCount ?? 0,
          intervalStage: schedule?.intervalStage ?? 0,
        },
        enabled: true,
        context: {
          learningItem: {
            id: learningItem.id,
            expression: learningItem.expression,
            normalizedExpression: learningItem.normalizedExpression,
            status: 'active',
            sensePin: learningItem.sensePin,
            productiveUseIntent:
              learningItem.productiveUseIntent === true,
          },
          encounters: encounters.map((encounter) => ({
            id: encounter.id,
            learningItemId: encounter.learningItemId,
            selection: encounter.selection,
            sensePin: encounter.sensePin,
          })),
          generation: {
            model: input.configuration.model.id,
            promptVersion: REVIEW_PROMPT_VERSION,
          },
        },
        approval: approvals[0] ?? null,
      });
    }
  }
  return targets;
}
