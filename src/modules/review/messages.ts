import type { ReviewSessionView, ReviewSchedule } from './review-session-store';

export type ReviewSessionSnapshot = Readonly<{
  eligibleCount: number;
  activeSession: ReviewSessionView | null;
  schedules: readonly ReviewSchedule[];
}>;

export type ReviewRequest =
  | { type: 'get-review-session' }
  | { type: 'start-review-session' }
  | { type: 'reveal-review-item'; sessionId: string }
  | { type: 'advance-review-session'; sessionId: string };

export type ReviewResponse =
  | { status: 'loaded'; snapshot: ReviewSessionSnapshot }
  | { status: 'unavailable'; eligibleCount: 0 }
  | {
      status: 'started' | 'active' | 'revealed' | 'completed';
      session: ReviewSessionView;
    }
  | { status: 'failed'; message: string };
