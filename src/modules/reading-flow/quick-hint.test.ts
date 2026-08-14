import { describe, expect, it } from 'vitest';
import { parseQuickHint } from './quick-hint';

describe('Quick Hint contract', () => {
  it('accepts a structured result', () => {
    expect(
      parseQuickHint({
        simplerExpression: 'delay until a later time',
        explanationCue: '延後原本安排的事情',
      }),
    ).toEqual({
      simplerExpression: 'delay until a later time',
      explanationCue: '延後原本安排的事情',
    });
  });

  it('rejects a malformed structured result', () => {
    expect(() => parseQuickHint({ explanationCue: null })).toThrow();
  });

});
