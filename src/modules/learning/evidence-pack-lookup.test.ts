import { describe, expect, it } from 'vitest';
import {
  ACTIVE_EVIDENCE_INDEX_STORAGE_KEY,
  createStoredEligibleSenseLookup,
} from './evidence-pack-lookup';

function storage(value: unknown) {
  return {
    async get(key: string) {
      return { [key]: value };
    },
  };
}

describe('active Evidence Pack lookup', () => {
  it('returns only candidates eligible by normalized expression, morphology, and part of speech', async () => {
    const lookup = createStoredEligibleSenseLookup(
      storage({
        version: 1,
        evidencePackVersion: 'oewn-test-2025.1',
        entries: [
          {
            normalizedExpression: 'postponed',
            morphology: 'past-tense-of:postpone',
            partOfSpeech: 'verb',
            sourceSenseId: 'oewn:02642814-v',
          },
          {
            normalizedExpression: 'postponed',
            morphology: 'adjectival-participle-of:postpone',
            partOfSpeech: 'adjective',
            sourceSenseId: 'oewn:01518924-a',
          },
          {
            normalizedExpression: 'postpone',
            morphology: 'lemma',
            partOfSpeech: 'verb',
            sourceSenseId: 'oewn:02642814-v',
          },
        ],
        occurrenceAnalyses: [
          {
            lookupRecordId: 'lookup-1',
            normalizedExpression: 'postponed',
            morphology: 'past-tense-of:postpone',
            partOfSpeech: 'verb',
          },
          {
            lookupRecordId: 'lookup-2',
            normalizedExpression: 'postpone',
            morphology: 'lemma',
            partOfSpeech: 'verb',
          },
          {
            lookupRecordId: 'lookup-ambiguous',
            normalizedExpression: 'postponed',
            morphology: 'past-tense-of:postpone',
            partOfSpeech: 'verb',
          },
          {
            lookupRecordId: 'lookup-ambiguous',
            normalizedExpression: 'postponed',
            morphology: 'adjectival-participle-of:postpone',
            partOfSpeech: 'adjective',
          },
        ],
      }),
    );

    await expect(
      lookup.findEligibleSenses({
        lookupRecordId: 'lookup-1',
        normalizedExpression: 'postponed',
      }),
    ).resolves.toEqual({
      evidencePackVersion: 'oewn-test-2025.1',
      candidates: [
        {
          morphology: 'past-tense-of:postpone',
          partOfSpeech: 'verb',
          sourceSenseId: 'oewn:02642814-v',
        },
      ],
    });
    await expect(
      lookup.findEligibleSenses({
        lookupRecordId: 'lookup-2',
        normalizedExpression: 'postpone',
      }),
    ).resolves.toEqual({
      evidencePackVersion: 'oewn-test-2025.1',
      candidates: [
        {
          morphology: 'lemma',
          partOfSpeech: 'verb',
          sourceSenseId: 'oewn:02642814-v',
        },
      ],
    });
    await expect(
      lookup.findEligibleSenses({
        lookupRecordId: 'lookup-ambiguous',
        normalizedExpression: 'postponed',
      }),
    ).resolves.toBeNull();
  });

  it('treats missing or malformed active evidence as unavailable', async () => {
    const missing = createStoredEligibleSenseLookup(storage(undefined));
    const malformed = createStoredEligibleSenseLookup(
      storage({
        version: 1,
        evidencePackVersion: 'pack',
        entries: [{ normalizedExpression: '<script>' }],
      }),
    );

    await expect(
      missing.findEligibleSenses({
        lookupRecordId: 'missing',
        normalizedExpression: 'postpone',
      }),
    ).resolves.toBeNull();
    await expect(
      malformed.findEligibleSenses({
        lookupRecordId: 'malformed',
        normalizedExpression: 'postpone',
      }),
    ).resolves.toBeNull();
    expect(ACTIVE_EVIDENCE_INDEX_STORAGE_KEY).toBe('activeEvidenceIndexV1');
  });
});
