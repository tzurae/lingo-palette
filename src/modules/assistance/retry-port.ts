export type RetryInstruction = {
  attempt: number;
  retryAfterMs?: number;
};

export interface RetryPort {
  wait(instruction: RetryInstruction, signal: AbortSignal): Promise<void>;
}
