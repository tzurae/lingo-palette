export type SurfacePosition = {
  left: number;
  top: number;
};

type RgbaColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

export function selectionAnchorRect(range: Range): DOMRect | null {
  const firstRect = Array.from(range.getClientRects()).find(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  if (firstRect !== undefined) return firstRect;
  const boundingRect = range.getBoundingClientRect();
  return boundingRect.width > 0 || boundingRect.height > 0
    ? boundingRect
    : null;
}

export function reserveReadingLineSpace(
  range: Range,
  extraPixels: number,
): () => void {
  const currentDocument = range.commonAncestorContainer.ownerDocument;
  if (currentDocument === null) return () => {};
  const commonAncestor = range.commonAncestorContainer;
  let current =
    commonAncestor instanceof HTMLElement
      ? commonAncestor
      : commonAncestor.parentElement;

  while (
    current !== null &&
    current !== currentDocument.body &&
    current !== currentDocument.documentElement
  ) {
    const display = getComputedStyle(current).display;
    if (
      display === 'block' ||
      display === 'list-item' ||
      display === 'table-cell' ||
      display === 'flex' ||
      display === 'grid'
    ) {
      break;
    }
    current = current.parentElement;
  }

  if (
    current === null ||
    current === currentDocument.body ||
    current === currentDocument.documentElement
  ) {
    return () => {};
  }

  const element = current;
  const computed = getComputedStyle(element);
  const fontSize = Number.parseFloat(computed.fontSize);
  const computedLineHeight = Number.parseFloat(computed.lineHeight);
  const lineHeight = Number.isFinite(computedLineHeight)
    ? computedLineHeight
    : fontSize * 1.2;
  const inlineLineHeight = element.style.getPropertyValue('line-height');
  const inlinePriority = element.style.getPropertyPriority('line-height');

  element.style.setProperty(
    'line-height',
    `${lineHeight + extraPixels}px`,
    'important',
  );

  return () => {
    if (inlineLineHeight.length === 0) {
      element.style.removeProperty('line-height');
    } else {
      element.style.setProperty(
        'line-height',
        inlineLineHeight,
        inlinePriority,
      );
    }
  };
}

export function quietPeekPosition(
  anchorRect: DOMRect,
  surfaceRect: DOMRect,
  copyRect: DOMRect,
  viewport: { width: number; height: number },
  gap: number,
  viewportGap: number,
): SurfacePosition {
  const copyCenterOffset =
    copyRect.left - surfaceRect.left + copyRect.width / 2;
  const maximumLeft = Math.max(
    viewportGap,
    viewport.width - surfaceRect.width - viewportGap,
  );
  const preferredLeft =
    anchorRect.left + anchorRect.width / 2 - copyCenterOffset;
  const left = Math.min(
    Math.max(preferredLeft, viewportGap),
    maximumLeft,
  );
  const preferredTop = anchorRect.top - surfaceRect.height - gap;
  const top =
    preferredTop >= viewportGap
      ? preferredTop
      : Math.min(
          anchorRect.bottom + gap,
          viewport.height - surfaceRect.height - viewportGap,
        );
  return { left, top };
}

export function contrastingInkForElement(
  element: Element,
): 'dark' | 'light' {
  const background = resolvedBackgroundColor(element);
  const darkInk = { red: 0, green: 0, blue: 0, alpha: 1 };
  const lightInk = { red: 255, green: 255, blue: 255, alpha: 1 };
  return contrastRatio(lightInk, background) >= contrastRatio(darkInk, background)
    ? 'light'
    : 'dark';
}

function resolvedBackgroundColor(element: Element): RgbaColor {
  let resolved: RgbaColor = { red: 0, green: 0, blue: 0, alpha: 0 };
  let current: Element | null = element;
  while (current !== null && resolved.alpha < 0.99) {
    const color = parseCssColor(getComputedStyle(current).backgroundColor);
    if (color !== null && color.alpha > 0) {
      resolved = compositeColor(resolved, color);
    }
    current = current.parentElement;
  }
  return compositeColor(resolved, {
    red: 255,
    green: 255,
    blue: 255,
    alpha: 1,
  });
}

function parseCssColor(value: string): RgbaColor | null {
  if (value === 'transparent') {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (channels === undefined || channels.length < 3) return null;
  return {
    red: channels[0] ?? 0,
    green: channels[1] ?? 0,
    blue: channels[2] ?? 0,
    alpha: channels[3] ?? 1,
  };
}

function compositeColor(
  foreground: RgbaColor,
  background: RgbaColor,
): RgbaColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return foreground;
  const channel = (foregroundValue: number, backgroundValue: number): number =>
    (foregroundValue * foreground.alpha +
      backgroundValue * background.alpha * (1 - foreground.alpha)) /
    alpha;
  return {
    red: channel(foreground.red, background.red),
    green: channel(foreground.green, background.green),
    blue: channel(foreground.blue, background.blue),
    alpha,
  };
}

function contrastRatio(first: RgbaColor, second: RgbaColor): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function relativeLuminance(color: RgbaColor): number {
  const linearize = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linearize(color.red) +
    0.7152 * linearize(color.green) +
    0.0722 * linearize(color.blue)
  );
}
