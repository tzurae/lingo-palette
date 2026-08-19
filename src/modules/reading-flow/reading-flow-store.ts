import { createStore, type StoreApi } from 'zustand/vanilla';

import type {
  PronunciationPlaybackState,
  PronunciationVariety,
} from '../pronunciation/playback';
import type { SelectionSnapshot } from './selection';

export type ExpandedFocusTarget = 'first-action' | 'pronunciation';

export type QuickHintState =
  | { status: 'idle' }
  | { status: 'scheduled' }
  | { status: 'loading' }
  | {
      status: 'ready';
      simplerExpression: string;
      explanationCue: string | null;
    }
  | { status: 'failed'; message: string }
  | { status: 'cancelled'; message: string }
  | { status: 'unavailable'; message: string };

export type SurfaceState =
  | { mode: 'hidden' }
  | { mode: 'peek' }
  | {
      mode: 'expanded';
      focusTarget: ExpandedFocusTarget | null;
      focusRequest: number;
    };

export type SiteAccessState =
  | { status: 'disabled' }
  | { status: 'enabled' };

export type ReadingFlowState = {
  selection: SelectionSnapshot | null;
  selectionStableAt: number;
  siteAccess: SiteAccessState;
  surface: SurfaceState;
  quickHint: QuickHintState;
  pronunciation: PronunciationPlaybackState;
  statusMessage: string;
  select(selection: SelectionSnapshot, selectionStableAt: number): void;
  clearSelection(): void;
  setSiteAccess(siteAccess: SiteAccessState): void;
  showPeek(): void;
  expand(focusTarget?: ExpandedFocusTarget): void;
  setQuickHint(quickHint: QuickHintState): void;
  setPronunciation(pronunciation: PronunciationPlaybackState): void;
  setStatusMessage(message: string): void;
  reset(): void;
};

export type ReadingFlowStore = StoreApi<ReadingFlowState>;

export function createReadingFlowStore(
  pronunciation: PronunciationPlaybackState,
): ReadingFlowStore {
  return createStore<ReadingFlowState>((set) => ({
    selection: null,
    selectionStableAt: 0,
    siteAccess: { status: 'disabled' },
    surface: { mode: 'hidden' },
    quickHint: { status: 'idle' },
    pronunciation,
    statusMessage: '',
    select(selection, selectionStableAt) {
      set({ selection, selectionStableAt });
    },
    clearSelection() {
      set({
        selection: null,
        selectionStableAt: 0,
        surface: { mode: 'hidden' },
        quickHint: { status: 'idle' },
        statusMessage: '',
      });
    },
    setSiteAccess(siteAccess) {
      set({ siteAccess });
    },
    showPeek() {
      set({ surface: { mode: 'peek' } });
    },
    expand(focusTarget) {
      set((state) => ({
        surface: {
          mode: 'expanded',
          focusTarget: focusTarget ?? null,
          focusRequest:
            state.surface.mode === 'expanded'
              ? state.surface.focusRequest + 1
              : 1,
        },
      }));
    },
    setQuickHint(quickHint) {
      set({ quickHint });
    },
    setPronunciation(pronunciation) {
      set({ pronunciation });
    },
    setStatusMessage(statusMessage) {
      set({ statusMessage });
    },
    reset() {
      set({
        selection: null,
        selectionStableAt: 0,
        surface: { mode: 'hidden' },
        quickHint: { status: 'idle' },
        statusMessage: '',
      });
    },
  }));
}

export function pronunciationButtonLabel(
  variety: PronunciationVariety,
): string {
  return variety === 'en-US' ? '美式發音' : '英式發音';
}
