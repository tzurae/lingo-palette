export type Selection = {
  text: string;
  context: {
    before: string;
    after: string;
  };
};

export type QuickHintAction = {
  kind: 'quick-hint';
};

export type DeepDiveAction = {
  kind: 'deep-dive';
};

export type CustomAction = {
  kind: 'custom';
  id: string;
  name: string;
  instructions: string;
};
export type Action = QuickHintAction | DeepDiveAction | CustomAction;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type GenerationFailureDetails = {
  kind:
    | 'connection'
    | 'timeout'
    | 'rate-limited'
    | 'provider-unavailable'
    | 'authentication'
    | 'permission'
    | 'invalid-request'
    | 'provider-quota';
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
};

export class GenerationFailure extends Error {
  readonly kind: GenerationFailureDetails['kind'];
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(details: GenerationFailureDetails) {
    super(details.message);
    this.name = 'GenerationFailure';
    this.kind = details.kind;
    this.retryable = details.retryable;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export type QuickHintGeneration = {
  kind: 'quick-hint';
  simplerExpression: string;
  explanationCue: string | null;
  usage: TokenUsage;
};

export type DeepDiveGeneration = {
  kind: 'deep-dive';
  contextualMeaning: string;
  usageFit: string;
  grammarPattern: string;
  alternatives: Array<{
    expression: string;
    distinction: string;
  }>;
  examples: string[];
  usage: TokenUsage;
};

export type CustomGeneration = {
  kind: 'custom';
  markdown: string;
  usage: TokenUsage;
};

export type Generation =
  | QuickHintGeneration
  | DeepDiveGeneration
  | CustomGeneration;

export type GenerationRequest = {
  selection: Selection;
  action: Action;
};

export interface GenerationPort {
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
  ): Promise<Generation>;
}
