import { z } from 'zod';

const auditableReviewTaskSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('contrastive'),
      prompt: z.string().min(1),
      contextQuote: z.string().min(1),
      targetAnswers: z.array(z.string().min(1)).min(1),
      acceptableAlternativeAnswers: z.array(z.string().min(1)),
      partialAnswers: z.array(z.string().min(1)),
      distractors: z.array(z.string().min(1)).min(1),
      correctiveExplanation: z.string().min(1),
    })
    .passthrough(),
  z
    .object({
      type: z.enum(['recall', 'productive']),
      prompt: z.string().min(1),
      contextQuote: z.string().min(1),
      targetAnswers: z.array(z.string().min(1)).min(1),
      acceptableAlternativeAnswers: z.array(z.string().min(1)),
      partialAnswers: z.array(z.string().min(1)),
      correctiveExplanation: z.string().min(1),
    })
    .passthrough(),
]);

const approvedReviewSourceStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(
      z
        .object({
          id: z.string().min(1),
          task: auditableReviewTaskSchema,
          provenance: z
            .object({
              approvedAt: z.iso.datetime(),
              evidencePack: z
                .object({
                  id: z.string().min(1),
                  version: z.string().min(1),
                })
                .passthrough(),
              relevantEvidence: z.array(z.object({}).passthrough()).min(1),
              licenseAndAttribution: z
                .array(
                  z
                    .object({
                      sourceId: z.string().min(1),
                      sourceName: z.string().min(1),
                      sourceVersion: z.string().min(1),
                    })
                    .passthrough(),
                )
                .min(1),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type ApprovedReviewSourceItem = {
  id: string;
  sourceItemPath: string;
};

export function inspectApprovedReviewSource(
  value: unknown,
): readonly ApprovedReviewSourceItem[] {
  const source = locateApprovedReviewState(value);
  const latestItems = source.state.records
    .map((record, index) => ({ record, index }))
    .toSorted(
      (left, right) =>
        right.record.provenance.approvedAt.localeCompare(
          left.record.provenance.approvedAt,
        ) || left.record.id.localeCompare(right.record.id),
    )
    .slice(0, 50)
    .map(({ record, index }) => ({
      id: record.id,
      sourceItemPath: `${source.recordPathPrefix}.${index}`,
    }));
  if (latestItems.length !== 50) {
    throw new Error(
      `Approved Review Item source contains ${latestItems.length} record(s); the latest 50 are required.`,
    );
  }
  return latestItems;
}

function locateApprovedReviewState(value: unknown): {
  state: z.infer<typeof approvedReviewSourceStateSchema>;
  recordPathPrefix: string;
} {
  const direct = approvedReviewSourceStateSchema.safeParse(value);
  if (direct.success) {
    return {
      state: direct.data,
      recordPathPrefix: 'records',
    };
  }
  const portable = z
    .object({
      state: z
        .object({
          review: z
            .object({
              approvedItems: z.unknown(),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough()
    .parse(value);
  return {
    state: approvedReviewSourceStateSchema.parse(
      portable.state.review.approvedItems,
    ),
    recordPathPrefix: 'state.review.approvedItems.records',
  };
}
