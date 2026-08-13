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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
