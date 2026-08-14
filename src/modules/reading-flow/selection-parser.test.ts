import { describe, expect, it } from 'vitest';
import { parseSelection } from './selection-parser';

describe('Selection parser', () => {
  it('passes only bounded Selection data across assistance and persistence seams', () => {
    expect(
      parseSelection({
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

  it('rejects rather than truncates over-limit data', () => {
    expect(() =>
      parseSelection({
        text: '😀'.repeat(4_001),
        context: { before: '', after: '' },
      }),
    ).toThrow();
    expect(() =>
      parseSelection({
        text: 'postpone',
        context: { before: 'a'.repeat(2_001), after: '' },
      }),
    ).toThrow();
  });
});
