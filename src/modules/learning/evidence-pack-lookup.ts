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
const occurrenceAnalysisSchema = z
  .object({
    lookupRecordId: z.string().min(1),
    normalizedExpression: z.string().min(1),
    morphology: z.string().min(1),
    partOfSpeech: z.string().min(1),
  })
  .strict();
const activeEvidenceIndexSchema = z
  .object({
    version: z.literal(1),
    evidencePackVersion: z.string().min(1),
    entries: z.array(evidenceEntrySchema),
    occurrenceAnalyses: z.array(occurrenceAnalysisSchema),
  })
  .strict();

export type EvidenceIndexStorage = {
  get(key: string): Promise<Record<string, unknown>>;
};

export function createStoredEligibleSenseLookup(
  storage: EvidenceIndexStorage,
): EligibleSenseLookup {
  return {
    async findEligibleSenses({ lookupRecordId, normalizedExpression }) {
      const stored = await storage.get(ACTIVE_EVIDENCE_INDEX_STORAGE_KEY);
      const parsed = activeEvidenceIndexSchema.safeParse(
        stored[ACTIVE_EVIDENCE_INDEX_STORAGE_KEY],
      );
      if (!parsed.success) return null;
      const analyses = parsed.data.occurrenceAnalyses.filter(
        (analysis) =>
          analysis.lookupRecordId === lookupRecordId &&
          analysis.normalizedExpression === normalizedExpression,
      );
      if (analyses.length !== 1) return null;
      const analysis = analyses[0];
      if (analysis === undefined) return null;
      return {
        evidencePackVersion: parsed.data.evidencePackVersion,
        candidates: parsed.data.entries
          .filter(
            (entry) =>
              entry.normalizedExpression === normalizedExpression &&
              entry.morphology === analysis.morphology &&
              entry.partOfSpeech === analysis.partOfSpeech,
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
