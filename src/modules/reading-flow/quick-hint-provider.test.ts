import { describe, expect, it } from 'vitest';
import { createOpenAiQuickHintProvider } from './quick-hint-provider';

describe('Quick Hint provider seam', () => {
  it('sends only bounded Selection data and parses a structured result', async () => {
    let requestBody: unknown;
    const fetchImplementation: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            simplerExpression: 'delay until a later time',
            explanationCue: '延後原本安排的事情',
          }),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const provider = createOpenAiQuickHintProvider(
      'test-key',
      fetchImplementation,
    );

    await expect(
      provider.generate({
        text: 'postpone',
        context: {
          before: 'The committee decided to ',
          after: ' the vote.',
        },
      }),
    ).resolves.toEqual({
      simplerExpression: 'delay until a later time',
      explanationCue: '延後原本安排的事情',
    });

    const serialized = JSON.stringify(requestBody);
    expect(serialized).toContain('postpone');
    expect(serialized).not.toMatch(/pageTitle|url|DOM|permission|Lookup/i);
  });

  it('rejects a malformed structured result', async () => {
    const provider = createOpenAiQuickHintProvider(
      'test-key',
      async () =>
        new Response(JSON.stringify({ output_text: '{\"explanationCue\":null}' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      provider.generate({
        text: 'postpone',
        context: { before: '', after: '' },
      }),
    ).rejects.toThrow('invalid structured Quick Hint');
  });
});
