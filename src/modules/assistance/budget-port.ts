import type { GenerationRequest, TokenUsage } from './generation-port';

export type BudgetReservation = {
  id: string;
};

export interface BudgetPort {
  reserve(request: GenerationRequest): Promise<BudgetReservation | null>;
  settle(
    reservation: BudgetReservation,
    actualUsage: TokenUsage,
  ): Promise<void>;
  release(reservation: BudgetReservation): Promise<void>;
}
