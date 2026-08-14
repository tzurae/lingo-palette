import { z } from 'zod';

const quickHintSchema = z.object({
  simplerExpression: z.string().min(1),
  explanationCue: z.string().min(1).nullable(),
});

export type QuickHintResult = z.infer<typeof quickHintSchema>;

export function parseQuickHint(value: unknown): QuickHintResult {
  return quickHintSchema.parse(value);
}

