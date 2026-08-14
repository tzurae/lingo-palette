import type { ProviderUsage } from '../openai/budget-ledger';
import type {
  AssistanceFailureKind,
} from '../openai/quick-hint-executor';
import type { LookupRecord } from '../learning/lookup-record';
import type { DeepDiveState } from './deep-dive-state';
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
export type StartDeepDiveRequest = {
  type: 'start-deep-dive';
  selection: Selection;
};
export type GetDeepDiveStateRequest = {
  type: 'get-deep-dive-state';
};
export type RetryDeepDiveRequest = {
  type: 'retry-deep-dive';
};
export type CancelDeepDiveRequest = {
  type: 'cancel-deep-dive';
};
export type GetRecentRequest = {
  type: 'get-recent';
};

export type ReadingFlowRequest =
  | EnableSiteRequest
  | SiteStatusRequest
  | QuickHintRequest
  | CancelQuickHintRequest
  | StartDeepDiveRequest
  | GetDeepDiveStateRequest
  | RetryDeepDiveRequest
  | CancelDeepDiveRequest
  | GetRecentRequest;

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

export type DeepDiveResponse =
  | {
      status: 'started';
      requestId: string;
    }
  | {
      status: 'loaded';
      state: DeepDiveState;
    }
  | {
      status: 'failed' | 'cancelled';
      message: string;
    };

export type RecentResponse =
  | {
      status: 'loaded';
      records: LookupRecord[];
    }
  | {
      status: 'failed';
      message: string;
    };
