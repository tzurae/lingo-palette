import { describe, expect, it } from 'vitest';
import { parseDogfoodActivityRequest } from './messages';

describe('dogfood activity messages', () => {
  it('accepts only metadata and rejects Selection content', () => {
    expect(parseDogfoodActivityRequest({ type: 'record-dogfood-selection' })).toEqual({
      type: 'record-dogfood-selection',
    });
    expect(
      parseDogfoodActivityRequest({
        type: 'record-dogfood-pronunciation',
        variety: 'en-GB',
        sentenceCount: 2,
      }),
    ).toEqual({
      type: 'record-dogfood-pronunciation',
      variety: 'en-GB',
      sentenceCount: 2,
    });
    expect(() =>
      parseDogfoodActivityRequest({
        type: 'record-dogfood-selection',
        selection: 'private Selection content',
      }),
    ).toThrow();
  });
});
