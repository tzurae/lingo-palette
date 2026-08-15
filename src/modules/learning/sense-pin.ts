import { z } from 'zod';

export const sensePinSchema = z
  .object({
    evidencePackVersion: z.string().min(1),
    sourceSenseId: z.string().min(1),
    morphology: z.string().min(1),
    partOfSpeech: z.string().min(1),
  })
  .strict();

export type SensePin = z.infer<typeof sensePinSchema>;
