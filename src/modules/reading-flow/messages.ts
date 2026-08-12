import type { Selection } from '../assistance/generation-port';
import type { QuickHint } from './quick-hint-provider';

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
  | { status: 'completed'; result: QuickHint }
  | { status: 'failed'; message: string };
