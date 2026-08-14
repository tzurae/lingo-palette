import { z } from 'zod';
import {
  codePointLength,
  CONTEXT_LIMIT,
  SELECTION_LIMIT,
  type Selection,
} from './selection';

const boundedText = (limit: number) =>
  z.string().refine((value) => codePointLength(value) <= limit);

export const selectionSchema = z.object({
  text: boundedText(SELECTION_LIMIT).refine((value) => value.length > 0),
  context: z.object({
    before: boundedText(CONTEXT_LIMIT),
    after: boundedText(CONTEXT_LIMIT),
  }),
});

export function parseSelection(value: unknown): Selection {
  return selectionSchema.parse(value);
}
