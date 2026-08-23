import type { PronunciationVariety } from '../pronunciation/playback';
import type {
  DeepDiveResponse,
  EnableSiteResponse,
  QuickHintResponse,
} from './messages';
import type { Selection } from './selection';

export type ReadingFlowProgress =
  | { type: 'quick-hint'; message: string }
  | { type: 'pronunciation'; requestId: string; message: string };

export type ReadingFlowClient = {
  siteStatus(origin: string): Promise<EnableSiteResponse>;
  enableSite(origin: string): Promise<EnableSiteResponse>;
  requestQuickHint(selection: Selection): Promise<QuickHintResponse>;
  cancelQuickHint(): Promise<QuickHintResponse>;
  requestDeepDive(selection: Selection): Promise<DeepDiveResponse>;
  recordSelection(): Promise<unknown>;
  recordPronunciation(
    variety: PronunciationVariety,
    sentenceCount: number,
  ): Promise<unknown>;
  onProgress(listener: (progress: ReadingFlowProgress) => void): () => void;
};

export function createReadingFlowClient(): ReadingFlowClient {
  return {
    siteStatus(origin: string): Promise<EnableSiteResponse> {
      return browser.runtime.sendMessage({ type: 'site-status', origin });
    },
    enableSite(origin: string): Promise<EnableSiteResponse> {
      return browser.runtime.sendMessage({ type: 'enable-site', origin });
    },
    requestQuickHint(selection: Selection): Promise<QuickHintResponse> {
      return browser.runtime.sendMessage({ type: 'quick-hint', selection });
    },
    cancelQuickHint(): Promise<QuickHintResponse> {
      return browser.runtime.sendMessage({ type: 'cancel-quick-hint' });
    },
    requestDeepDive(selection: Selection): Promise<DeepDiveResponse> {
      return browser.runtime.sendMessage({ type: 'start-deep-dive', selection });
    },
    recordSelection(): Promise<unknown> {
      return browser.runtime.sendMessage({ type: 'record-dogfood-selection' });
    },
    recordPronunciation(
      variety: PronunciationVariety,
      sentenceCount: number,
    ): Promise<unknown> {
      return browser.runtime.sendMessage({
        type: 'record-dogfood-pronunciation',
        variety,
        sentenceCount,
      });
    },
    onProgress(listener: (progress: ReadingFlowProgress) => void): () => void {
      const handleMessage = (message: unknown) => {
        if (
          typeof message !== 'object' ||
          message === null ||
          !('type' in message) ||
          !('message' in message) ||
          typeof message.message !== 'string'
        ) {
          return;
        }
        if (message.type === 'quick-hint-progress') {
          listener({ type: 'quick-hint', message: message.message });
          return;
        }
        if (
          message.type === 'pronunciation-progress' &&
          'requestId' in message &&
          typeof message.requestId === 'string'
        ) {
          listener({
            type: 'pronunciation',
            requestId: message.requestId,
            message: message.message,
          });
        }
      };
      browser.runtime.onMessage.addListener(handleMessage);
      return () => browser.runtime.onMessage.removeListener(handleMessage);
    },
  };
}
