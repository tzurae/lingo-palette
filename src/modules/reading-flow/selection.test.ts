import { describe, expect, it } from 'vitest';
import { fitAnchoredSurface } from './anchored-surface';
import { boundReadingContext, codePointLength } from './selection';

describe('Reading Flow selection boundaries', () => {
  it('measures Unicode code points rather than UTF-16 code units', () => {
    expect('A😀𠮷'.length).toBe(5);
    expect(codePointLength('A😀𠮷')).toBe(3);
  });

  it('bounds Reading Context to 2,000 Unicode code points on each side', () => {
    const before = `${'a'.repeat(2_100)}😀`;
    const selected = 'postpone';
    const after = `𠮷${'z'.repeat(2_100)}`;
    const context = boundReadingContext(
      `${before}${selected}${after}`,
      codePointLength(before),
      codePointLength(selected),
    );

    expect(codePointLength(context.before)).toBe(2_000);
    expect(context.before).toMatch(/😀$/);
    expect(codePointLength(context.after)).toBe(2_000);
    expect(context.after).toMatch(/^𠮷/);
  });

  it('keeps the anchored surface inside every viewport edge', () => {
    expect(
      fitAnchoredSurface(
        { left: 990, right: 1_000, top: 790, bottom: 800 },
        { width: 320, height: 160 },
        { width: 1_000, height: 800 },
      ),
    ).toEqual({ left: 672, top: 622 });
    expect(
      fitAnchoredSurface(
        { left: -40, right: 2, top: 0, bottom: 10 },
        { width: 320, height: 160 },
        { width: 1_000, height: 800 },
      ),
    ).toEqual({ left: 8, top: 18 });
  });
});
