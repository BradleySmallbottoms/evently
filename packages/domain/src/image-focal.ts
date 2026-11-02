/** A point on a photo. `x` is from the left, `y` is from the top, both from 0 to 1. */
export interface ImageFocal {
  x: number;
  y: number;
}

/** A model point that sits on the photo. Anything outside 0–1 is refused. */
export function imageFocalPoint(value: unknown): ImageFocal | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { x?: unknown; y?: unknown };
  const { x, y } = record;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/**
 * `expo-image` content position for a cover crop. A missing point stays centered.
 * Percentages match CSS object-position: the point on the photo lines up with the same point in the frame.
 */
export function imageContentPosition(
  focal: ImageFocal | null | undefined,
): { left: string; top: string } | 'center' {
  const point = focal ? imageFocalPoint(focal) : null;
  if (!point) return 'center';
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` };
}
