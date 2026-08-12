import { z } from 'zod';
import {
  codePointLength,
  CONTEXT_LIMIT,
  SELECTION_LIMIT,
  type Selection,
} from './selection';

const quickHintSchema = z.object({
  simplerExpression: z.string().min(1),
  explanationCue: z.string().min(1).nullable(),
});
const boundedText = (limit: number) =>
  z.string().refine((value) => codePointLength(value) <= limit);

const providerSelectionSchema = z.object({
  text: boundedText(SELECTION_LIMIT).refine((value) => value.length > 0),
  context: z.object({
    before: boundedText(CONTEXT_LIMIT),
    after: boundedText(CONTEXT_LIMIT),
  }),
});

export type QuickHintResult = z.infer<typeof quickHintSchema>;

export function parseQuickHint(value: unknown): QuickHintResult {
  return quickHintSchema.parse(value);
}

export function parseQuickHintSelection(value: unknown): Selection {
  return providerSelectionSchema.parse(value);
}
