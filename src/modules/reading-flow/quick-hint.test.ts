import { describe, expect, it } from 'vitest';
import { parseQuickHint, parseQuickHintSelection } from './quick-hint';

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

  it('passes only bounded Selection data to the provider seam', () => {
    expect(
      parseQuickHintSelection({
        text: 'postpone',
        context: { before: 'to ', after: ' the vote', dom: '<p>private</p>' },
        url: 'https://reading.example/private',
        title: 'Private title',
        enabledSite: 'https://reading.example',
        lookupHistory: ['earlier lookup'],
      }),
    ).toEqual({
      text: 'postpone',
      context: { before: 'to ', after: ' the vote' },
    });
  });

  it('rejects rather than truncates over-limit provider input', () => {
    expect(() =>
      parseQuickHintSelection({
        text: '😀'.repeat(4_001),
        context: { before: '', after: '' },
      }),
    ).toThrow();
    expect(() =>
      parseQuickHintSelection({
        text: 'postpone',
        context: { before: 'a'.repeat(2_001), after: '' },
      }),
    ).toThrow();
  });
});
