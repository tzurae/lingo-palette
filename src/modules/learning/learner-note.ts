import { z } from 'zod';

export const LEARNER_NOTES_STORAGE_KEY = 'learnerNotesV1';

const learnerNoteSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    learningItemId: z.string().min(1),
    content: z.string().min(1).max(10_000),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const learnerNotesStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(learnerNoteSchema),
  })
  .strict();

export type LearnerNote = z.infer<typeof learnerNoteSchema>;
export type LearnerNotesState = z.infer<typeof learnerNotesStateSchema>;

export function parseLearnerNotesState(value: unknown): LearnerNotesState {
  return learnerNotesStateSchema.parse(value);
}
