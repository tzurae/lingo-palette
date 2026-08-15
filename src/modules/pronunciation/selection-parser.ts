import { z } from 'zod';
import {
  codePointLength,
  CONTEXT_LIMIT,
  type Selection,
} from '../reading-flow/selection';
import { MAXIMUM_PRONUNCIATION_CHUNK_CHARACTERS } from './limits';


const boundedText = (limit: number) =>
  z.string().refine((value) => codePointLength(value) <= limit);

const pronunciationSelectionSchema = z.object({
  text: boundedText(MAXIMUM_PRONUNCIATION_CHUNK_CHARACTERS).refine(
    (value) => value.length > 0,
  ),
  context: z.object({
    before: boundedText(CONTEXT_LIMIT),
    after: boundedText(CONTEXT_LIMIT),
  }),
});

export function parsePronunciationSelection(value: unknown): Selection {
  return pronunciationSelectionSchema.parse(value);
}
