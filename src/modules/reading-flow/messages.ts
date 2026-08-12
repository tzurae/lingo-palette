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

export type ReadingFlowRequest =
  | EnableSiteRequest
  | SiteStatusRequest
  | QuickHintRequest;

export type EnableSiteResponse = {
  enabled: boolean;
  message?: string;
};

export type QuickHintResponse =
  | { status: 'completed'; result: QuickHintResult }
  | { status: 'failed'; message: string };
