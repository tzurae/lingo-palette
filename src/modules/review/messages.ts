import type {
  RecordedReviewEvidence,
  ReviewSessionView,
  ReviewSchedule,
} from './review-session-store';

export type ReviewSessionSnapshot = Readonly<{
  eligibleCount: number;
  activeSession: ReviewSessionView | null;
  schedules: readonly ReviewSchedule[];
  evidence: readonly RecordedReviewEvidence[];
}>;

export type ReviewRequest =
  | { type: 'get-review-session' }
  | { type: 'start-review-session' }
  | {
      type: 'answer-review-item';
      sessionId: string;
      retrievalFluency:
        | 'did-not-recall'
        | 'recalled-with-effort'
        | 'recalled-fluently';
      responseText?: string;
    }
  | { type: 'advance-review-session'; sessionId: string };

export type ReviewResponse =
  | { status: 'loaded'; snapshot: ReviewSessionSnapshot }
  | { status: 'unavailable'; eligibleCount: 0 }
  | {
      status: 'started' | 'active' | 'revealed' | 'completed';
      session: ReviewSessionView;
    }
  | { status: 'failed'; message: string };
