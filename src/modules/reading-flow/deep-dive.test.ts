import { describe, expect, it } from 'vitest';
import { parseDeepDive } from './deep-dive';

const deepDive = {
  contextualMeaning:
    'Here, “postpone” means deciding that the vote will happen later.',
  usageFit:
    'Neutral and common in formal decisions; it fits a committee vote.',
  grammarPattern: {
    pattern: 'postpone + noun / gerund',
    explanation: 'Use a noun or an -ing form for the delayed event.',
  },
  alternatives: [
    {
      expression: 'put off',
      distinction: 'More conversational than “postpone”.',
    },
    {
      expression: 'defer',
      distinction: 'More formal and often used for official decisions.',
    },
  ],
  examples: [
    {
      sentence: 'The committee postponed the vote until next week.',
      explanation: 'The noun “the vote” names the delayed event.',
    },
    {
      sentence: 'They postponed making a final decision.',
      explanation: 'The gerund phrase names the delayed action.',
    },
  ],
};

describe('Deep Dive structured contract', () => {
  it('accepts every extension-owned analysis section', () => {
    expect(parseDeepDive(deepDive)).toEqual(deepDive);
  });

  it('rejects missing, empty, or provider-invented sections', () => {
    expect(() =>
      parseDeepDive({ ...deepDive, alternatives: [] }),
    ).toThrow();
    expect(() => {
      const { usageFit: _usageFit, ...missingUsageFit } = deepDive;
      return parseDeepDive(missingUsageFit);
    }).toThrow();
    expect(() =>
      parseDeepDive({ ...deepDive, providerCommentary: 'free-form' }),
    ).toThrow();
  });
});
