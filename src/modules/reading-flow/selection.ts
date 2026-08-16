export type Selection = {
  text: string;
  context: {
    before: string;
    after: string;
  };
};

export const SELECTION_LIMIT = 4_000;
export const CONTEXT_LIMIT = 2_000;
const excludedSelectionSurfaceSelector =
  'form, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

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
  if (intersectsExcludedSelectionSurface(range)) return null;
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

function intersectsExcludedSelectionSurface(range: Range): boolean {
  const commonElement =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (commonElement === null) return true;
  if (commonElement.closest(excludedSelectionSurfaceSelector) !== null) {
    return true;
  }
  for (const excluded of commonElement.querySelectorAll(
    excludedSelectionSurfaceSelector,
  )) {
    if (range.intersectsNode(excluded)) return true;
  }
  return false;
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
