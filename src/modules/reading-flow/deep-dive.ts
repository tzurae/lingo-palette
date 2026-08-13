import { z } from 'zod';

const boundedSection = z.string().min(1).max(2_000);
const deepDiveSchema = z
  .object({
    contextualMeaning: boundedSection,
    usageFit: boundedSection,
    grammarPattern: z
      .object({
        pattern: z.string().min(1).max(500),
        explanation: boundedSection,
      })
      .strict(),
    alternatives: z
      .array(
        z
          .object({
            expression: z.string().min(1).max(300),
            distinction: boundedSection,
          })
          .strict(),
      )
      .min(1)
      .max(5),
    examples: z
      .array(
        z
          .object({
            sentence: z.string().min(1).max(1_000),
            explanation: boundedSection,
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();

export type DeepDiveResult = z.infer<typeof deepDiveSchema>;

export function parseDeepDive(value: unknown): DeepDiveResult {
  return deepDiveSchema.parse(value);
}
