import type { ProviderUsage } from '../openai/budget-ledger';
import type {
  AssistanceFailureKind,
} from '../openai/quick-hint-executor';
import type { QuickHintResult } from './quick-hint';
import type { Selection } from './selection';

export type EnableSiteRequest = {
  type: 'enable-site';
  origin: string;
};
export type SiteStatusRequest = {
  type: 'site-status';
  origin: string;
};


export type QuickHintRequest = {
  type: 'quick-hint';
  selection: Selection;
};
export type CancelQuickHintRequest = {
  type: 'cancel-quick-hint';
};

export type ReadingFlowRequest =
  | EnableSiteRequest
  | SiteStatusRequest
  | QuickHintRequest
  | CancelQuickHintRequest;

export type EnableSiteResponse = {
  enabled: boolean;
  message?: string;
};

export type QuickHintResponse =
  | {
      status: 'completed';
      result: QuickHintResult;
      source: 'cache' | 'provider';
      usage: ProviderUsage | null;
      attempts: number;
    }
  | {
      status: 'cancelled';
      message: string;
    }
  | {
      status: 'failed';
      message: string;
      kind?: AssistanceFailureKind;
      retryable?: boolean;
      attempts?: number;
    };
