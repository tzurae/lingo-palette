import type { LearningState } from './learning-item-store';

export type GetSavedRequest = { type: 'get-saved' };
export type SaveLookupRequest = {
  type: 'save-lookup';
  lookupRecordId: string;
};
export type ResolveMergeSuggestionRequest = {
  type: 'resolve-merge-suggestion';
  suggestionId: string;
  decision: 'merge' | 'keep-separate';
};
export type UndoLearningMutationRequest = {
  type: 'undo-learning-mutation';
  mutationId: string;
};
export type ReclassifyEncounterRequest = {
  type: 'reclassify-encounter';
  encounterId: string;
  targetLearningItemId: string;
};
export type SetProductiveUseIntentRequest = {
  type: 'set-productive-use-intent';
  learningItemId: string;
  enabled: boolean;
};

export type LearningRequest =
  | GetSavedRequest
  | SaveLookupRequest
  | ResolveMergeSuggestionRequest
  | UndoLearningMutationRequest
  | ReclassifyEncounterRequest
  | SetProductiveUseIntentRequest;

export type LearningResponse =
  | { status: 'loaded'; state: LearningState }
  | { status: 'failed'; message: string };
