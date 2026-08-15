import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_ENGLISH_EVIDENCE_PACK,
  type ContextualMeaningEvidence,
  type PinnedEnglishEvidencePack,
} from '../evidence/bundled-english-evidence-pack';
import { createReviewGenerationHarness } from './review-generation-harness';

const learningContext = {
  learningItem: {
    id: 'learning-1',
    expression: 'postponed',
    normalizedExpression: 'postponed',
    status: 'active' as const,
    sensePin: {
      evidencePackVersion: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.version,
      sourceSenseId: 'oewn:02648898-v',
      morphology: 'past-tense-of:postpone',
      partOfSpeech: 'verb',
    },
  },
  encounters: [
    {
      id: 'encounter-1',
      learningItemId: 'learning-1',
      selection: {
        text: 'postponed',
        context: {
          before: 'The committee ',
          after: ' the vote until next week.',
        },
      },
      sensePin: {
        evidencePackVersion: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.version,
        sourceSenseId: 'oewn:02648898-v',
        morphology: 'past-tense-of:postpone',
        partOfSpeech: 'verb',
      },
    },
  ],
};

const groundedCandidate = {
  type: 'contrastive' as const,
  learningItemId: 'learning-1',
  encounterId: 'encounter-1',
  knowledgeDimension: 'contextual-meaning' as const,
  prompt: 'What does “postponed” mean in this sentence?',
  contextQuote: 'The committee postponed the vote until next week.',
  acceptedAnswers: ['hold back to a later time'],
  distractors: ['cancel permanently', 'approve immediately'],
  correctiveExplanation:
    'Here, “postponed” means that the vote was moved to a later time.',
};

const usageLearningContext = {
  learningItem: {
    ...learningContext.learningItem,
    expression: 'postpone',
    normalizedExpression: 'postpone',
    sensePin: {
      ...learningContext.learningItem.sensePin,
      morphology: 'base-form:postpone',
    },
  },
  encounters: [
    {
      id: 'encounter-1',
      learningItemId: 'learning-1',
      selection: {
        text: 'postpone',
        context: { before: "let's ", after: ' the exam' },
      },
      sensePin: {
        evidencePackVersion:
          BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.version,
        sourceSenseId: 'oewn:02648898-v',
        morphology: 'base-form:postpone',
        partOfSpeech: 'verb',
      },
    },
  ],
};

const usageFitCandidate = {
  type: 'contrastive' as const,
  learningItemId: 'learning-1',
  encounterId: 'encounter-1',
  knowledgeDimension: 'usage-fit' as const,
  prompt: 'Does “postpone” fit this context?',
  contextQuote: "let's postpone the exam",
  claimedFit: 'fits' as const,
  acceptedAnswers: ['yes, it fits this context'],
  distractors: ['no, it cannot be used with exam'],
  correctiveExplanation:
    '“Postpone” fits because the exam will happen at a later time.',
};

const grammarPatternCandidate = {
  type: 'contrastive' as const,
  learningItemId: 'learning-1',
  encounterId: 'encounter-1',
  knowledgeDimension: 'grammar-pattern' as const,
  prompt: 'Which grammar pattern does “postponed” use here?',
  contextQuote: 'The committee postponed the vote until next week.',
  claimedPattern: 'Somebody postpones something',
  claimScope: 'observed' as const,
  acceptedAnswers: ['subject + postpone + object'],
  distractors: ['postpone must never take an object'],
  correctiveExplanation:
    'Here, “postponed” takes “the vote” as its object.',
};

const passingEvaluation = {
  grounding: 'pass' as const,
  answerability: 'pass' as const,
  linguisticAccuracy: 'pass' as const,
  constructValidity: 'pass' as const,
  distractorSafety: 'pass' as const,
  correctiveExplanation: 'pass' as const,
  validAlternativeAnswers: ['delay until later'],
  partialAnswers: ['moved somehow'],
  evidenceAssessments: [
    {
      evidenceId: 'oewn-2025:02648898-v',
      relation: 'supports' as const,
    },
  ],
};

const VALIDATOR_VERSION = 'contextual-meaning-validator-v1';
const generationPin = {
  model: 'gpt-5-mini-2026-03-17',
  promptVersion: 'contextual-meaning-prompt-v1',
};

function createHarness(
  overrides: Partial<
    Parameters<typeof createReviewGenerationHarness>[0]
  > = {},
) {
  return createReviewGenerationHarness({
    evidencePack: BUNDLED_ENGLISH_EVIDENCE_PACK,
    evaluator: { evaluate: async () => passingEvaluation },
    validatorVersion: VALIDATOR_VERSION,
    ...overrides,
  });
}

const conflictingEvidencePack = withTestEvidencePackIntegrity({
  ...BUNDLED_ENGLISH_EVIDENCE_PACK,
  contextualMeanings: [
    ...BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings,
    {
      ...BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings[0],
      id: 'supplemental-test:postpone',
      sourceId: 'supplemental-test',
      definition: 'cancel permanently',
      authority: 'supplemental' as const,
    },
  ],
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function withTestEvidencePackIntegrity(
  evidencePack: PinnedEnglishEvidencePack,
): PinnedEnglishEvidencePack {
  const contents = [
    {
      path: 'contextual-meanings.json',
      content: JSON.stringify(evidencePack.contextualMeanings),
    },
    {
      path: 'usage-fits.json',
      content: JSON.stringify(evidencePack.usageFits),
    },
    {
      path: 'grammar-patterns.json',
      content: JSON.stringify(evidencePack.grammarPatterns),
    },
    {
      path: 'license-and-attribution.json',
      content: JSON.stringify(evidencePack.licenseAndAttribution),
    },
    ...evidencePack.manifest.licenses.map((manifestLicense) => {
      const license = evidencePack.licenses.find(
        (candidate) => candidate.id === manifestLicense.id,
      );
      if (license === undefined) {
        throw new Error(`Missing test license ${manifestLicense.id}.`);
      }
      return { path: manifestLicense.path, content: license.text };
    }),
  ];
  const contentHashes = contents.map(({ path, content }) => ({
    path,
    byteSize: Buffer.byteLength(content),
    sha256: sha256(content),
  }));
  return {
    ...evidencePack,
    manifest: {
      ...evidencePack.manifest,
      installedSizeBytes: contentHashes.reduce(
        (total, entry) => total + entry.byteSize,
        0,
      ),
      contentIdentitySha256: sha256(JSON.stringify(contentHashes)),
      contentHashes,
    },
  };
}

describe('Review Generation harness', () => {
  it('ships verifiable OEWN evidence with complete offline license texts', () => {
    const oewnLicense = BUNDLED_ENGLISH_EVIDENCE_PACK.licenses.find(
      (license) => license.id === 'CC-BY-4.0',
    );
    const wordNetLicense = BUNDLED_ENGLISH_EVIDENCE_PACK.licenses.find(
      (license) => license.id === 'Princeton-WordNet-3.1',
    );
    expect(oewnLicense?.text).toContain(
      'Creative Commons Attribution 4.0 International License',
    );
    expect(wordNetLicense?.text).toContain(
      'WordNet 3.1 Copyright 2011 by Princeton University',
    );
    if (oewnLicense === undefined || wordNetLicense === undefined) {
      throw new Error('Expected both complete OEWN license texts.');
    }
    const installedFiles = [
      {
        path: 'contextual-meanings.json',
        content: JSON.stringify(
          BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings,
        ),
      },
      {
        path: 'usage-fits.json',
        content: JSON.stringify(BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits),
      },
      {
        path: 'grammar-patterns.json',
        content: JSON.stringify(
          BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns,
        ),
      },
      {
        path: 'license-and-attribution.json',
        content: JSON.stringify(
          BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution,
        ),
      },
      {
        path: 'licenses/OEWN-2025-LICENSE.md',
        content: oewnLicense.text,
      },
      {
        path: 'licenses/WNDB_License.txt',
        content: wordNetLicense.text,
      },
    ];
    const hashes = installedFiles.map(({ path, content }) => ({
      path,
      byteSize: Buffer.byteLength(content),
      sha256: sha256(content),
    }));

    expect(hashes).toEqual([
      {
        path: 'contextual-meanings.json',
        byteSize: 349,
        sha256:
          'e31fd3bb1cbee8a4ab11bc83c6dcbec80356fe576f6ee4c78dcd0ef7110f6ad6',
      },
      {
        path: 'usage-fits.json',
        byteSize: 302,
        sha256:
          'a095d9707ebc87389a75a3bf3247da76ad3e4fca174df8ae3dac5f9babcd901e',
      },
      {
        path: 'grammar-patterns.json',
        byteSize: 322,
        sha256:
          '9f4b322e09aecf500741a90de5158139750f030e70cacac9bb1318f40779c660',
      },
      {
        path: 'license-and-attribution.json',
        byteSize: 1_051,
        sha256:
          '3e8104d8cf265a153e341e384a9edab62a7cc4cc852e10bb1c0a7c83cd287bbe',
      },
      {
        path: 'licenses/OEWN-2025-LICENSE.md',
        byteSize: 19_863,
        sha256:
          '672cc8b5663e8dc74c4b07a9dcf477193853575b119908fd3dc0aeeb60a9dbbb',
      },
      {
        path: 'licenses/WNDB_License.txt',
        byteSize: 1_740,
        sha256:
          'df30ec18fbabcdaf031b79ea026d3e6b959010cffe6dd7be9ac137822175b904',
      },
    ]);
    expect(BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.contentHashes).toEqual(
      hashes,
    );
    expect(BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.installedSizeBytes).toBe(
      installedFiles.reduce(
        (total, file) => total + Buffer.byteLength(file.content),
        0,
      ),
    );
    expect(BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.compressedSizeBytes).toBe(
      7_654,
    );
    expect(
      BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.compressedSizeBytes,
    ).toBeLessThan(BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.installedSizeBytes);
    expect(
      BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.contentIdentitySha256,
    ).toBe(sha256(JSON.stringify(hashes)));
  });
  it('approves one grounded contextual-meaning Review Item with pinned provenance', async () => {
    const harness = createHarness({
      id: () => 'review-1',
      now: () => '2026-08-14T12:00:00.000Z',
    });

    const result = await harness.review({
      ...learningContext,
      generation: generationPin,
      candidate: groundedCandidate,
    });

    expect(result).toEqual({
      status: 'approved',
      item: expect.objectContaining({
        version: 1,
        id: 'review-1',
        learningItemId: 'learning-1',
        knowledgeDimension: 'contextual-meaning',
        task: {
          type: 'contrastive',
          prompt: groundedCandidate.prompt,
          contextQuote: groundedCandidate.contextQuote,
          targetAnswers: ['hold back to a later time'],
          acceptableAlternativeAnswers: ['delay until later'],
          partialAnswers: ['moved somehow'],
          distractors: groundedCandidate.distractors,
          correctiveExplanation: groundedCandidate.correctiveExplanation,
        },
        provenance: expect.objectContaining({
          approvedAt: '2026-08-14T12:00:00.000Z',
          generation: {
            model: 'gpt-5-mini-2026-03-17',
            promptVersion: 'contextual-meaning-prompt-v1',
          },
          validatorVersion: 'contextual-meaning-validator-v1',
          evidencePack: expect.objectContaining({
            id: 'lingo-palette-en-contextual-meaning-minimal',
            schemaVersion: 1,
            version: '2025.1.0-minimal.2',
            language: 'en',
            minimumExtensionVersion: '0.0.0',
            compressedSizeBytes: 7_654,
            installedSizeBytes: 23_627,
            contentIdentitySha256:
              '9597180e44214c2085173797a718709137f92f44cc0136fc99264697960b5d63',
            sources: [
              expect.objectContaining({
                id: 'oewn',
                version: '2025',
                asset: 'english-wordnet-2025-json.zip',
                sha256:
                  '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51',
              }),
            ],
          }),
          relevantEvidence: [
            expect.objectContaining({
              id: 'oewn-2025:02648898-v',
              sourceSenseId: 'oewn:02648898-v',
              partOfSpeech: 'verb',
              definition: 'hold back to a later time',
            }),
          ],
          licenseAndAttribution: [
            expect.objectContaining({
              sourceId: 'oewn',
              sourceVersion: '2025',
              attribution:
                'Open English WordNet 2025 © 2019-present Open English WordNet Team; based on WordNet 3.1 © 2011 Princeton University.',
              licenseIdentifiers: ['CC-BY-4.0', 'Princeton-WordNet-3.1'],
            }),
          ],
        }),
      }),
    });
  });
  it('approves usage fit only from matching sense-context authority and pins it', async () => {
    const evidencePack = {
      ...BUNDLED_ENGLISH_EVIDENCE_PACK,
    };
    const harness = createHarness({
      evidencePack,
      evaluator: {
        evaluate: async ({ evidence }) => ({
          ...passingEvaluation,
          evidenceAssessments: evidence.map(({ id }) => ({
            evidenceId: id,
            relation: 'supports' as const,
          })),
        }),
      },
      id: () => 'review-usage-fit',
    });

    const result = await harness.review({
      ...usageLearningContext,
      generation: {
        model: generationPin.model,
        promptVersion: 'usage-fit-prompt-v1',
      },
      candidate: usageFitCandidate,
    });

    expect(result).toEqual({
      status: 'approved',
      item: expect.objectContaining({
        id: 'review-usage-fit',
        learningItemId: 'learning-1',
        knowledgeDimension: 'usage-fit',
        provenance: expect.objectContaining({
          relevantEvidence: [BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0]],
          sourceAuthority: {
            knowledgeDimension: 'usage-fit',
            evidence: [
              {
                evidenceId: BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0].id,
                sourceId: BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0].sourceId,
                sourceVersion:
                  BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0].sourceVersion,
                authority: 'sense-context',
              },
            ],
          },
        }),
      }),
    });
  });
  it('approves an observed grammar pattern from a matching source-recorded frame', async () => {
    const harness = createHarness({
      evaluator: {
        evaluate: async ({ evidence }) => ({
          ...passingEvaluation,
          evidenceAssessments: evidence.map(({ id }) => ({
            evidenceId: id,
            relation: 'supports' as const,
          })),
        }),
      },
      id: () => 'review-grammar-pattern',
    });

    const result = await harness.review({
      ...learningContext,
      generation: {
        model: generationPin.model,
        promptVersion: 'grammar-pattern-prompt-v1',
      },
      candidate: grammarPatternCandidate,
    });

    expect(result).toEqual({
      status: 'approved',
      item: expect.objectContaining({
        id: 'review-grammar-pattern',
        knowledgeDimension: 'grammar-pattern',
        provenance: expect.objectContaining({
          relevantEvidence: [
            BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns[0],
          ],
          sourceAuthority: {
            knowledgeDimension: 'grammar-pattern',
            evidence: [
              expect.objectContaining({
                evidenceId:
                  BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns[0].id,
                authority: 'source-recorded-frame',
              }),
            ],
          },
        }),
      }),
    });
  });
  it.each(['lexical-relation', 'frequency'] as const)(
    'does not let %s evidence approve contextual usage fit',
    async (authority) => {
      const evidencePack = withTestEvidencePackIntegrity({
        ...BUNDLED_ENGLISH_EVIDENCE_PACK,
        usageFits: [
          {
            ...BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0],
            authority,
          },
        ],
      });
      const harness = createHarness({
        evidencePack,
        evaluator: {
          evaluate: async ({ evidence }) => ({
            ...passingEvaluation,
            evidenceAssessments: evidence.map(({ id }) => ({
              evidenceId: id,
              relation: 'supports' as const,
            })),
          }),
        },
      });

      await expect(
        harness.review({
          ...usageLearningContext,
          generation: generationPin,
          candidate: usageFitCandidate,
        }),
      ).resolves.toEqual({
        status: 'rejected',
        reason: 'evidence-unavailable',
      });
    },
  );

  it('rejects usage fit when source context or license provenance does not match', async () => {
    const wrongContextPack = withTestEvidencePackIntegrity({
      ...BUNDLED_ENGLISH_EVIDENCE_PACK,
      usageFits: [
        {
          ...BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0],
          contextQuote: 'They postpone an unrelated launch',
        },
      ],
    });
    const missingSourceProvenancePack = withTestEvidencePackIntegrity({
      ...BUNDLED_ENGLISH_EVIDENCE_PACK,
      usageFits: [
        {
          ...BUNDLED_ENGLISH_EVIDENCE_PACK.usageFits[0],
          sourceId: 'unlicensed-source',
        },
      ],
    });
    const evaluate = async ({ evidence }: { evidence: readonly { id: string }[] }) => ({
      ...passingEvaluation,
      evidenceAssessments: evidence.map(({ id }) => ({
        evidenceId: id,
        relation: 'supports' as const,
      })),
    });

    await expect(
      createHarness({
        evidencePack: wrongContextPack,
        evaluator: { evaluate },
      }).review({
        ...usageLearningContext,
        generation: generationPin,
        candidate: usageFitCandidate,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'evidence-unavailable',
    });
    await expect(
      createHarness({
        evidencePack: missingSourceProvenancePack,
        evaluator: { evaluate },
      }).review({
        ...usageLearningContext,
        generation: generationPin,
        candidate: usageFitCandidate,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'evidence-unavailable',
    });
  });

  it('requires a source-recorded grammar authority or repeated POS-aware attestations', async () => {
    const corpusEvidence = [1, 2].map((index) => ({
      ...BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns[0],
      id: `corpus-grammar-${index}`,
      authority: 'pos-aware-corpus-attestation' as const,
      attestation: `Corpus attestation ${index}`,
    }));
    const evaluate = async ({ evidence }: { evidence: readonly { id: string }[] }) => ({
      ...passingEvaluation,
      evidenceAssessments: evidence.map(({ id }) => ({
        evidenceId: id,
        relation: 'supports' as const,
      })),
    });
    const sourceRecordedUsageNoteHarness = createHarness({
      evidencePack: withTestEvidencePackIntegrity({
        ...BUNDLED_ENGLISH_EVIDENCE_PACK,
        grammarPatterns: [
          {
            ...BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns[0],
            authority: 'source-recorded-usage-note',
          },
        ],
      }),
      evaluator: { evaluate },
    });
    const repeatedCorpusHarness = createHarness({
      evidencePack: withTestEvidencePackIntegrity({
        ...BUNDLED_ENGLISH_EVIDENCE_PACK,
        grammarPatterns: corpusEvidence,
      }),
      evaluator: { evaluate },
    });
    const partiallySupportedCorpusHarness = createHarness({
      evidencePack: withTestEvidencePackIntegrity({
        ...BUNDLED_ENGLISH_EVIDENCE_PACK,
        grammarPatterns: corpusEvidence,
      }),
      evaluator: {
        evaluate: async ({ evidence }) => ({
          ...passingEvaluation,
          evidenceAssessments: evidence.map(({ id }, index) => ({
            evidenceId: id,
            relation: index === 0 ? ('supports' as const) : ('unknown' as const),
          })),
        }),
      },
    });
    const mixedAuthorityHarness = createHarness({
      evidencePack: withTestEvidencePackIntegrity({
        ...BUNDLED_ENGLISH_EVIDENCE_PACK,
        grammarPatterns: [
          BUNDLED_ENGLISH_EVIDENCE_PACK.grammarPatterns[0],
          ...corpusEvidence,
        ],
      }),
      evaluator: {
        evaluate: async ({ evidence }) => ({
          ...passingEvaluation,
          evidenceAssessments: evidence.map(({ id }, index) => ({
            evidenceId: id,
            relation: index < 2 ? ('supports' as const) : ('unknown' as const),
          })),
        }),
      },
    });
    const oneObservationHarness = createHarness({
      evidencePack: withTestEvidencePackIntegrity({
        ...BUNDLED_ENGLISH_EVIDENCE_PACK,
        grammarPatterns: [corpusEvidence[0]!],
      }),
      evaluator: { evaluate },
    });

    await expect(
      sourceRecordedUsageNoteHarness.review({
        ...learningContext,
        generation: generationPin,
        candidate: grammarPatternCandidate,
      }),
    ).resolves.toMatchObject({
      status: 'approved',
      item: {
        provenance: {
          sourceAuthority: {
            evidence: [{ authority: 'source-recorded-usage-note' }],
          },
        },
      },
    });
    await expect(
      repeatedCorpusHarness.review({
        ...learningContext,
        generation: generationPin,
        candidate: grammarPatternCandidate,
      }),
    ).resolves.toMatchObject({
      status: 'approved',
      item: {
        knowledgeDimension: 'grammar-pattern',
        provenance: {
          sourceAuthority: {
            knowledgeDimension: 'grammar-pattern',
            evidence: [
              { authority: 'pos-aware-corpus-attestation' },
              { authority: 'pos-aware-corpus-attestation' },
            ],
          },
        },
      },
    });
    await expect(
      partiallySupportedCorpusHarness.review({
        ...learningContext,
        generation: generationPin,
        candidate: grammarPatternCandidate,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'evidence-unavailable',
    });
    await expect(
      mixedAuthorityHarness.review({
        ...learningContext,
        generation: generationPin,
        candidate: grammarPatternCandidate,
      }),
    ).resolves.toMatchObject({
      status: 'approved',
      item: {
        provenance: {
          sourceAuthority: {
            evidence: [
              {
                authority: 'source-recorded-frame',
              },
            ],
          },
        },
      },
    });
    await expect(
      oneObservationHarness.review({
        ...learningContext,
        generation: generationPin,
        candidate: grammarPatternCandidate,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'evidence-unavailable',
    });
  });

  it('rejects unsupported universal grammar rules and cross-dimension payloads', async () => {
    const harness = createHarness({
      evaluator: {
        evaluate: async ({ evidence }) => ({
          ...passingEvaluation,
          evidenceAssessments: evidence.map(({ id }) => ({
            evidenceId: id,
            relation: 'supports' as const,
          })),
        }),
      },
    });

    await expect(
      harness.review({
        ...learningContext,
        generation: generationPin,
        candidate: {
          ...grammarPatternCandidate,
          claimScope: 'universal',
        },
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'evidence-unavailable',
    });
    await expect(
      harness.review({
        ...usageLearningContext,
        generation: generationPin,
        candidate: {
          ...usageFitCandidate,
          claimedPattern: grammarPatternCandidate.claimedPattern,
        } as never,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid-input' });
  });
  it('falls back to grounded recall when a distractor hides a valid alternative', async () => {
    const harness = createHarness({
      id: () => 'review-fallback',
      now: () => '2026-08-14T12:00:00.000Z',
    });

    const result = await harness.review({
      ...learningContext,
      generation: generationPin,
      candidate: {
        ...groundedCandidate,
        distractors: ['delay  until later', 'approve immediately'],
      },
    });

    expect(result).toEqual({
      status: 'approved',
      item: expect.objectContaining({
        id: 'review-fallback',
        task: {
          type: 'recall',
          prompt: 'What does “postponed” mean in this context?',
          contextQuote: groundedCandidate.contextQuote,
          targetAnswers: ['hold back to a later time'],
          acceptableAlternativeAnswers: ['delay until later'],
          partialAnswers: ['moved somehow'],
          correctiveExplanation:
            'Here, “postponed” means “hold back to a later time”.',
        },
        provenance: expect.objectContaining({
          validation: {
            outcome: 'safe-fallback',
            reasons: ['hidden-valid-alternative'],
          },
        }),
      }),
    });
  });
  it('lets primary lexical evidence override conflicting supplemental evidence', async () => {
    const harnessFor = (primaryRelation: 'supports' | 'contradicts') =>
      createHarness({
        evidencePack: conflictingEvidencePack,
        evaluator: {
          evaluate: async () => ({
            ...passingEvaluation,
            evidenceAssessments: [
              {
                evidenceId: 'oewn-2025:02648898-v',
                relation: primaryRelation,
              },
              {
                evidenceId: 'supplemental-test:postpone',
                relation:
                  primaryRelation === 'supports' ? 'contradicts' : 'supports',
              },
            ],
          }),
        },
      });
    const input = {
      ...learningContext,
      generation: generationPin,
      candidate: groundedCandidate,
    };

    await expect(harnessFor('contradicts').review(input)).resolves.toEqual({
      status: 'rejected',
      reason: 'source-conflict',
    });
    await expect(harnessFor('supports').review(input)).resolves.toMatchObject({
      status: 'approved',
      item: {
        task: { type: 'contrastive' },
      },
    });
  });
  it('rejects duplicate assessments instead of making source conflict order-dependent', async () => {
    const harness = createHarness({
      evaluator: {
        evaluate: async () => ({
          ...passingEvaluation,
          evidenceAssessments: [
            {
              evidenceId: 'oewn-2025:02648898-v',
              relation: 'contradicts',
            },
            {
              evidenceId: 'oewn-2025:02648898-v',
              relation: 'supports',
            },
          ],
        }),
      },
    });

    await expect(
      harness.review({
        ...learningContext,
        generation: generationPin,
        candidate: groundedCandidate,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'evaluation-failed' });
  });
  it('requires revalidation when any approval pin changes', async () => {
    const generation = generationPin;
    const harness = createHarness({ id: () => 'review-reusable' });
    const approved = await harness.review({
      ...learningContext,
      generation,
      candidate: groundedCandidate,
    });
    if (approved.status !== 'approved') {
      throw new Error('Expected an approved Review Item fixture.');
    }

    expect(await harness.isReusable(approved.item, generation)).toBe(true);
    expect(
      await harness.isReusable(
        {
          ...approved.item,
          provenance: {
            ...approved.item.provenance,
            relevantEvidence: [],
          },
        },
        generation,
      ),
    ).toBe(false);
    expect(
      await harness.isReusable(approved.item, {
        ...generation,
        model: 'gpt-5-mini-2026-06-01',
      }),
    ).toBe(false);
    expect(
      await harness.isReusable(approved.item, {
        ...generation,
        promptVersion: 'contextual-meaning-prompt-v2',
      }),
    ).toBe(false);
    expect(
      await createHarness({
        validatorVersion: 'contextual-meaning-validator-v2',
      }).isReusable(approved.item, generation),
    ).toBe(false);
    expect(
      await createHarness({
        evidencePack: {
          ...BUNDLED_ENGLISH_EVIDENCE_PACK,
          manifest: {
            ...BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
            version: '2025.1.0-minimal.3',
          },
        },
      }).isReusable(approved.item, generation),
    ).toBe(false);
    expect(
      await createHarness({
        evidencePack: {
          ...BUNDLED_ENGLISH_EVIDENCE_PACK,
          manifest: {
            ...BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
            contentIdentitySha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      }).isReusable(approved.item, generation),
    ).toBe(false);
    expect(
      await createHarness({
        evidencePack: {
          ...BUNDLED_ENGLISH_EVIDENCE_PACK,
          manifest: {
            ...BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
            licenses: [],
          },
        },
      }).isReusable(approved.item, generation),
    ).toBe(false);
    expect(
      await createHarness({
        evidencePack: {
          ...BUNDLED_ENGLISH_EVIDENCE_PACK,
          contextualMeanings:
            BUNDLED_ENGLISH_EVIDENCE_PACK.contextualMeanings.map(
              (entry) => ({ ...entry, definition: 'tampered definition' }),
            ),
        },
      }).isReusable(approved.item, generation),
    ).toBe(false);
  });
  it('uses an immutable Evidence Pack snapshot after caching integrity', async () => {
    const mutableEvidencePack = structuredClone(
      BUNDLED_ENGLISH_EVIDENCE_PACK,
    ) as PinnedEnglishEvidencePack;
    let evidenceMutationBlocked = false;
    let candidateMutationBlocked = false;
    const harness = createHarness({
      evidencePack: mutableEvidencePack,
      evaluator: {
        evaluate: async ({ candidate, evidence }) => {
          try {
            candidate.prompt = 'evaluator mutation';
          } catch {
            candidateMutationBlocked = true;
          }
          try {
            (
              evidence[0] as ContextualMeaningEvidence & {
                definition: string;
              }
            ).definition = 'evaluator mutation';
          } catch {
            evidenceMutationBlocked = true;
          }
          return passingEvaluation;
        },
      },
    });
    (
      mutableEvidencePack.contextualMeanings[0] as ContextualMeaningEvidence & {
        definition: string;
      }
    ).definition = 'external mutation';

    const result = await harness.review({
      ...learningContext,
      generation: generationPin,
      candidate: groundedCandidate,
    });

    expect(result).toMatchObject({
      status: 'approved',
      item: {
        task: { prompt: groundedCandidate.prompt },
        provenance: {
          relevantEvidence: [{ definition: 'hold back to a later time' }],
        },
      },
    });
    expect(candidateMutationBlocked).toBe(true);
    expect(evidenceMutationBlocked).toBe(true);
  });
  it('accepts the complete saved Learning Item and Encounter record shapes', async () => {
    const harness = createHarness();
    const completeLearningItem = {
      ...learningContext.learningItem,
      version: 1,
      productiveUseIntent: false,
      createdAt: '2026-08-14T10:00:00.000Z',
    };
    const completeEncounter = {
      ...learningContext.encounters[0]!,
      version: 1,
      lookupRecordId: 'lookup-1',
      selection: {
        ...learningContext.encounters[0]!.selection,
        codePointLength: 9,
      },
      action: { type: 'quick-hint', result: { simplerExpression: 'delay' } },
      completedAt: '2026-08-14T09:59:00.000Z',
      savedAt: '2026-08-14T10:00:00.000Z',
    };

    await expect(
      harness.review({
        learningItem: completeLearningItem,
        encounters: [completeEncounter],
        generation: generationPin,
        candidate: groundedCandidate,
      }),
    ).resolves.toMatchObject({ status: 'approved' });
  });
  it('preserves a 4,000-code-point saved Selection at the public seam', async () => {
    const selection = '😀'.repeat(4_000);
    let evaluatedSelection: string | null = null;
    const harness = createHarness({
      evaluator: {
        evaluate: async ({ encounter }) => {
          evaluatedSelection = encounter.selection.text;
          return passingEvaluation;
        },
      },
    });

    const result = await harness.review({
      learningItem: {
        ...learningContext.learningItem,
        expression: selection,
        normalizedExpression: selection,
      },
      encounters: [
        {
          ...learningContext.encounters[0]!,
          selection: { text: selection, context: { before: '', after: '' } },
        },
      ],
      generation: generationPin,
      candidate: {
        ...groundedCandidate,
        contextQuote: selection,
      },
    });

    expect(result).toMatchObject({
      status: 'approved',
      item: { task: { contextQuote: selection } },
    });
    expect(evaluatedSelection).toBe(selection);
  });
  it('treats missing pinned evidence as unavailable without calling the evaluator', async () => {
    let evaluatorCalled = false;
    const harness = createHarness({
      evaluator: {
        evaluate: async () => {
          evaluatorCalled = true;
          return passingEvaluation;
        },
      },
    });
    const missingPin = {
      ...learningContext.learningItem.sensePin,
      evidencePackVersion: 'not-installed',
    };

    await expect(
      harness.review({
        learningItem: {
          ...learningContext.learningItem,
          sensePin: missingPin,
        },
        encounters: learningContext.encounters.map((encounter) => ({
          ...encounter,
          sensePin: missingPin,
        })),
        generation: generationPin,
        candidate: groundedCandidate,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'evidence-unavailable',
    });
    expect(evaluatorCalled).toBe(false);
  });

  it.each([
    {
      caseName: 'missing',
      notices: [],
    },
    {
      caseName: 'wrong-version',
      notices: BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution.map(
        (notice) => ({ ...notice, sourceVersion: '2024' }),
      ),
    },
  ])(
    'rejects approving evidence with $caseName license attribution',
    async ({ notices }) => {
      const harness = createHarness({
        evidencePack: {
          ...BUNDLED_ENGLISH_EVIDENCE_PACK,
          licenseAndAttribution: notices,
        },
      });

      await expect(
        harness.review({
          ...learningContext,
          generation: generationPin,
          candidate: groundedCandidate,
        }),
      ).resolves.toEqual({
        status: 'rejected',
        reason: 'evidence-unavailable',
      });
    },
  );

  it('rejects a bundled license text that does not match its pinned hash', async () => {
    const [firstLicense, ...otherLicenses] =
      BUNDLED_ENGLISH_EVIDENCE_PACK.licenses;
    if (firstLicense === undefined) {
      throw new Error('Expected a bundled license fixture.');
    }
    const harness = createHarness({
      evidencePack: {
        ...BUNDLED_ENGLISH_EVIDENCE_PACK,
        licenses: [
          { ...firstLicense, text: 'tampered license payload' },
          ...otherLicenses,
        ],
      },
    });

    await expect(
      harness.review({
        ...learningContext,
        generation: generationPin,
        candidate: groundedCandidate,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'evidence-unavailable',
    });
  });

  it('rejects license inventory hashes detached from verified payload bytes', async () => {
    const detachedHash = 'a'.repeat(64);
    const harness = createHarness({
      evidencePack: {
        ...BUNDLED_ENGLISH_EVIDENCE_PACK,
        manifest: {
          ...BUNDLED_ENGLISH_EVIDENCE_PACK.manifest,
          licenses: BUNDLED_ENGLISH_EVIDENCE_PACK.manifest.licenses.map(
            (license) =>
              license.id === 'CC-BY-4.0'
                ? { ...license, sha256: detachedHash }
                : license,
          ),
        },
        licenseAndAttribution:
          BUNDLED_ENGLISH_EVIDENCE_PACK.licenseAndAttribution.map((notice) => ({
            ...notice,
            licenseTextHashes: notice.licenseTextHashes.map((entry) =>
              entry.licenseIdentifier === 'CC-BY-4.0'
                ? { ...entry, sha256: detachedHash }
                : entry,
            ),
          })),
      },
    });

    await expect(
      harness.review({
        ...learningContext,
        generation: generationPin,
        candidate: groundedCandidate,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'evidence-unavailable',
    });
  });

  it.each([
    'grounding',
    'answerability',
    'linguisticAccuracy',
    'constructValidity',
    'correctiveExplanation',
  ] as const)('rejects a candidate when %s is not validated', async (criterion) => {
    const harness = createHarness({
      evaluator: {
        evaluate: async () => ({
          ...passingEvaluation,
          [criterion]: 'fail',
        }),
      },
    });

    await expect(
      harness.review({
        ...learningContext,
        generation: generationPin,
        candidate: groundedCandidate,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'candidate-unsafe' });
  });

  it('uses grounded recall when the evaluator cannot clear distractor safety', async () => {
    const harness = createHarness({
      evaluator: {
        evaluate: async () => ({
          ...passingEvaluation,
          distractorSafety: 'unknown',
        }),
      },
    });

    await expect(
      harness.review({
        ...learningContext,
        generation: generationPin,
        candidate: groundedCandidate,
      }),
    ).resolves.toMatchObject({
      status: 'approved',
      item: {
        task: { type: 'recall' },
        provenance: {
          validation: {
            outcome: 'safe-fallback',
            reasons: ['unsafe-distractor'],
          },
        },
      },
    });
  });

  it('rejects an unsafe contrastive candidate when the core task has no safe fallback', async () => {
    const harness = createHarness({
      evaluator: {
        evaluate: async () => ({
          ...passingEvaluation,
          constructValidity: 'fail',
          correctiveExplanation: 'fail',
        }),
      },
    });

    await expect(
      harness.review({
        ...learningContext,
        generation: generationPin,
        candidate: groundedCandidate,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'candidate-unsafe' });
  });

  it('never returns unchecked candidate or evaluator fields', async () => {
    const harness = createHarness();
    const input = {
      ...learningContext,
      generation: generationPin,
    };
    const uncheckedInput = {
      ...input,
      candidate: {
        ...groundedCandidate,
        uncheckedProviderPayload: '<script>unsafe()</script>',
      },
    };

    await expect(
      harness.review(uncheckedInput),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid-input' });
    const malformedEvaluationHarness = createHarness({
      evaluator: {
        evaluate: async () => ({
          ...passingEvaluation,
          uncheckedEvaluatorPayload: 'ignore all validation',
        }),
      },
    });
    await expect(
      malformedEvaluationHarness.review({
        ...input,
        candidate: groundedCandidate,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'evaluation-failed' });
  });
  it('rejects a context quote that omits the saved Encounter selection', async () => {
    let evaluatorCalled = false;
    const harness = createHarness({
      evaluator: {
        evaluate: async () => {
          evaluatorCalled = true;
          return passingEvaluation;
        },
      },
    });

    await expect(
      harness.review({
        ...learningContext,
        generation: generationPin,
        candidate: {
          ...groundedCandidate,
          contextQuote: 'the vote until next week',
        },
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'not-grounded' });
    expect(evaluatorCalled).toBe(false);
  });
  it('rejects a quote grounded in a different repeated Selection occurrence', async () => {
    let evaluatorCalled = false;
    const harness = createHarness({
      evaluator: {
        evaluate: async () => {
          evaluatorCalled = true;
          return passingEvaluation;
        },
      },
    });
    const repeatedSelectionContext = {
      ...learningContext,
      encounters: [
        {
          ...learningContext.encounters[0]!,
          selection: {
            text: 'postponed',
            context: {
              before:
                'The first postponed meant cancelled. The committee ',
              after: ' the vote until next week.',
            },
          },
        },
      ],
    };

    await expect(
      harness.review({
        ...repeatedSelectionContext,
        generation: generationPin,
        candidate: {
          ...groundedCandidate,
          contextQuote: 'The first postponed meant cancelled.',
        },
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'not-grounded' });
    expect(evaluatorCalled).toBe(false);
  });
});
