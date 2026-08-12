import type { Selection } from '../assistance/generation-port';

export const SELECTION_LIMIT = 4_000;
export const CONTEXT_LIMIT = 2_000;

export type SelectionSnapshot = {
  selection: Selection;
  codePointLength: number;
  range: Range;
};

export function captureSelection(
  document: Document,
  browserSelection: globalThis.Selection | null,
): SelectionSnapshot | null {
  if (
    browserSelection === null ||
    browserSelection.rangeCount === 0 ||
    browserSelection.isCollapsed
  ) {
    return null;
  }

  const range = browserSelection.getRangeAt(0).cloneRange();
  const text = browserSelection.toString();
  if (text.length === 0) return null;

  const documentText = collectDocumentText(document);
  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(document.body ?? document.documentElement);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const start = codePointLength(prefixRange.toString());
  const selectedLength = codePointLength(text);

  return {
    selection: {
      text,
      context: boundReadingContext(documentText, start, selectedLength),
    },
    codePointLength: selectedLength,
    range,
  };
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}
export function boundReadingContext(
  documentText: string,
  selectionStart: number,
  selectionLength: number,
): Selection['context'] {
  return {
    before: takeLastCodePoints(documentText, selectionStart, CONTEXT_LIMIT),
    after: takeCodePoints(
      documentText,
      selectionStart + selectionLength,
      CONTEXT_LIMIT,
    ),
  };
}


export function fitAnchoredSurface(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  surface: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
): { left: number; top: number } {
  const maximumLeft = Math.max(gap, viewport.width - surface.width - gap);
  const left = clamp(anchor.left, gap, maximumLeft);
  const roomBelow = viewport.height - anchor.bottom;
  const preferredTop =
    roomBelow >= surface.height + gap
      ? anchor.bottom + gap
      : anchor.top - surface.height - gap;
  const maximumTop = Math.max(gap, viewport.height - surface.height - gap);

  return {
    left,
    top: clamp(preferredTop, gap, maximumTop),
  };
}

function collectDocumentText(document: Document): string {
  const range = document.createRange();
  range.selectNodeContents(document.body ?? document.documentElement);
  return range.toString();
}

function takeLastCodePoints(
  value: string,
  end: number,
  maximum: number,
): string {
  const points = Array.from(value);
  return points.slice(Math.max(0, end - maximum), end).join('');
}

function takeCodePoints(value: string, start: number, maximum: number): string {
  return Array.from(value).slice(start, start + maximum).join('');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
