import { z } from 'zod';
import type { EligibleSenseLookup } from './learning-item-store';

export const ACTIVE_EVIDENCE_INDEX_STORAGE_KEY = 'activeEvidenceIndexV1';

const evidenceEntrySchema = z
  .object({
    normalizedExpression: z.string().min(1),
    morphology: z.string().min(1),
    partOfSpeech: z.string().min(1),
    sourceSenseId: z.string().min(1),
  })
  .strict();
const activeEvidenceIndexSchema = z
  .object({
    version: z.literal(1),
    evidencePackVersion: z.string().min(1),
    entries: z.array(evidenceEntrySchema),
  })
  .strict();

export type EvidenceIndexStorage = {
  get(key: string): Promise<Record<string, unknown>>;
};

export function createStoredEligibleSenseLookup(
  storage: EvidenceIndexStorage,
): EligibleSenseLookup {
  return {
    async findEligibleSenses(normalizedExpression) {
      const stored = await storage.get(ACTIVE_EVIDENCE_INDEX_STORAGE_KEY);
      const parsed = activeEvidenceIndexSchema.safeParse(
        stored[ACTIVE_EVIDENCE_INDEX_STORAGE_KEY],
      );
      if (!parsed.success) return null;
      return {
        evidencePackVersion: parsed.data.evidencePackVersion,
        candidates: parsed.data.entries
          .filter(
            (entry) => entry.normalizedExpression === normalizedExpression,
          )
          .map(({ morphology, partOfSpeech, sourceSenseId }) => ({
            morphology,
            partOfSpeech,
            sourceSenseId,
          })),
      };
    },
  };
}
