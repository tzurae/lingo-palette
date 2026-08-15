import { z } from 'zod';

export const measuredReviewKnowledgeDimensionSchema = z.enum([
  'contextual-meaning',
  'usage-fit',
  'grammar-pattern',
  'collocation',
  'productive-use',
]);

export const reviewSourceAuthoritySchema = z
  .object({
    knowledgeDimension: measuredReviewKnowledgeDimensionSchema,
    evidence: z
      .array(
        z
          .object({
            evidenceId: z.string().min(1),
            sourceId: z.string().min(1),
            sourceVersion: z.string().min(1),
            authority: z.enum([
              'primary-lexical',
              'sense-context',
              'source-recorded-frame',
              'source-recorded-usage-note',
              'pos-aware-corpus-attestation',
              'corpus-collocation',
            ]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((sourceAuthority, context) => {
    const allowed =
      sourceAuthority.knowledgeDimension === 'contextual-meaning'
        ? new Set(['primary-lexical'])
        : sourceAuthority.knowledgeDimension === 'usage-fit'
          ? new Set(['sense-context'])
          : sourceAuthority.knowledgeDimension === 'grammar-pattern'
            ? new Set([
                'source-recorded-frame',
                'source-recorded-usage-note',
                'pos-aware-corpus-attestation',
              ])
            : sourceAuthority.knowledgeDimension === 'collocation'
              ? new Set(['corpus-collocation'])
              : new Set([
                  'primary-lexical',
                  'sense-context',
                  'source-recorded-frame',
                  'source-recorded-usage-note',
                  'pos-aware-corpus-attestation',
                  'corpus-collocation',
                ]);
    const evidenceIds = new Set<string>();
    for (const [index, evidence] of sourceAuthority.evidence.entries()) {
      if (evidenceIds.has(evidence.evidenceId)) {
        context.addIssue({
          code: 'custom',
          path: ['evidence', index, 'evidenceId'],
          message: `Duplicate source authority evidence ${evidence.evidenceId}.`,
        });
      }
      evidenceIds.add(evidence.evidenceId);
    }
    if (
      sourceAuthority.knowledgeDimension === 'grammar-pattern' &&
      sourceAuthority.evidence.some(
        (entry) => entry.authority === 'pos-aware-corpus-attestation',
      ) &&
      sourceAuthority.evidence.filter(
        (entry) => entry.authority === 'pos-aware-corpus-attestation',
      ).length < 2
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'Grammar corpus authority requires repeated POS-aware attestations.',
      });
    }
    for (const [index, evidence] of sourceAuthority.evidence.entries()) {
      if (allowed.has(evidence.authority)) continue;
      context.addIssue({
        code: 'custom',
        path: ['evidence', index, 'authority'],
        message: `${evidence.authority} cannot authorize ${sourceAuthority.knowledgeDimension}.`,
      });
    }
  });

export type MeasuredReviewKnowledgeDimension = z.infer<
  typeof measuredReviewKnowledgeDimensionSchema
>;
export type ReviewSourceAuthority = z.infer<
  typeof reviewSourceAuthoritySchema
>;
