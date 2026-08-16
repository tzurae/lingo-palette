import { describe, expect, it } from 'vitest';
import { inspectApprovedReviewSource } from './approved-review-source';

function approvedRecord(index: number) {
  return {
    version: 1,
    id: `review-item-${index}`,
    task: {
      type: 'recall',
      prompt: `Prompt ${index}`,
      contextQuote: `Evidence excerpt ${index}`,
      targetAnswers: [`answer-${index}`],
      acceptableAlternativeAnswers: [`alternative-${index}`],
      partialAnswers: [],
      correctiveExplanation: `Explanation ${index}`,
    },
    provenance: {
      approvedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      evidencePack: { id: 'english', version: '2025.1.0' },
      relevantEvidence: [{ id: `evidence-${index}` }],
      licenseAndAttribution: [
        {
          sourceId: 'oewn',
          sourceName: 'Open English WordNet',
          sourceVersion: '2025',
        },
      ],
    },
  };
}

describe('approved Review Item dogfood source', () => {
  it('derives the latest 50 IDs and exact source paths from portable state', () => {
    const records = Array.from({ length: 51 }, (_, index) =>
      approvedRecord(index),
    );

    const latest = inspectApprovedReviewSource({
      schemaVersion: 1,
      state: {
        review: {
          approvedItems: { version: 1, records },
        },
      },
    });

    expect(latest).toHaveLength(50);
    expect(latest[0]).toEqual({
      id: 'review-item-50',
      sourceItemPath: 'state.review.approvedItems.records.50',
    });
    expect(latest.at(-1)).toEqual({
      id: 'review-item-1',
      sourceItemPath: 'state.review.approvedItems.records.1',
    });
  });

  it('rejects a source that omits auditable answer alternatives', () => {
    const records = Array.from({ length: 50 }, (_unused, index) => {
      const record = approvedRecord(index);
      const { acceptableAlternativeAnswers: _, ...task } = record.task;
      return { ...record, task };
    });

    expect(() =>
      inspectApprovedReviewSource({ version: 1, records }),
    ).toThrow();
  });
});
