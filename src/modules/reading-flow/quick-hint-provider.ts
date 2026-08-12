import type { Selection } from '../assistance/generation-port';

export type QuickHint = {
  simplerExpression: string;
  explanationCue: string | null;
};

export interface QuickHintProvider {
  generate(selection: Selection, signal?: AbortSignal): Promise<QuickHint>;
}
export function parseQuickHint(value: unknown): QuickHint {
  if (
    !isRecord(value) ||
    typeof value.simplerExpression !== 'string' ||
    value.simplerExpression.length === 0 ||
    !(
      value.explanationCue === null ||
      (typeof value.explanationCue === 'string' &&
        value.explanationCue.length > 0)
    )
  ) {
    throw new Error('OpenAI returned an invalid structured Quick Hint.');
  }
  return {
    simplerExpression: value.simplerExpression,
    explanationCue: value.explanationCue,
  };
}


export function createOpenAiQuickHintProvider(
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
): QuickHintProvider {
  return {
    async generate(selection, signal) {
      const response = await fetchImplementation(
        'https://api.openai.com/v1/responses',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-5.4-mini-2026-03-17',
            input: [
              {
                role: 'system',
                content:
                  'Return a simpler contextual English expression and, only when useful, one short Traditional Chinese explanation cue.',
              },
              {
                role: 'user',
                content: JSON.stringify(selection),
              },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'quick_hint',
                strict: true,
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    simplerExpression: { type: 'string' },
                    explanationCue: {
                      anyOf: [{ type: 'string' }, { type: 'null' }],
                    },
                  },
                  required: ['simplerExpression', 'explanationCue'],
                },
              },
            },
          }),
          signal: signal ?? null,
        },
      );

      if (!response.ok) {
        throw new Error(`OpenAI request failed (${response.status}).`);
      }

      const body: unknown = await response.json();
      const outputText = extractOutputText(body);
      return parseQuickHint(JSON.parse(outputText));
    },
  };
}

function extractOutputText(body: unknown): string {
  if (!isRecord(body)) throw new Error('OpenAI returned an invalid response.');
  if (typeof body.output_text === 'string') return body.output_text;
  if (!Array.isArray(body.output)) {
    throw new Error('OpenAI returned no structured Quick Hint.');
  }

  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === 'string') {
        return content.text;
      }
    }
  }

  throw new Error('OpenAI returned no structured Quick Hint.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
