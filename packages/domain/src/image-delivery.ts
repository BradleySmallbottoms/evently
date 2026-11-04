/** Widths CloudFront will actually produce. Anything else snaps to the nearest step. */
export const IMAGE_DELIVERY_WIDTHS = [400, 800, 1200, 1600] as const;
/** Qualities CloudFront will actually produce. */
export const IMAGE_DELIVERY_QUALITIES = [60, 75, 85] as const;
/** Used when the request does not ask for a width. */
export const IMAGE_DELIVERY_WIDTH = 1600;
/** Used when the request does not ask for a quality. */
export const IMAGE_DELIVERY_QUALITY = 75;

export type ImageDeliverySize = { width: number; quality: number };

function nearest(
  raw: string | null | undefined,
  allowed: readonly number[],
  fallback: number,
): number {
  const text = raw?.trim() ?? '';
  if (text.length === 0) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value)) return fallback;
  let best: number = allowed[0] ?? fallback;
  let distance = Math.abs(value - best);
  for (const option of allowed) {
    const next = Math.abs(value - option);
    if (next < distance) {
      best = option;
      distance = next;
    }
  }
  return best;
}

/** The size a CloudFront image request will be served at. Invalid values snap to a step. */
export function imageDeliverySize(input: {
  w?: string | null;
  q?: string | null;
}): ImageDeliverySize {
  return {
    width: nearest(input.w, IMAGE_DELIVERY_WIDTHS, IMAGE_DELIVERY_WIDTH),
    quality: nearest(input.q, IMAGE_DELIVERY_QUALITIES, IMAGE_DELIVERY_QUALITY),
  };
}

/** Adds `w` and `q` to a public image URL. Local Garage ignores them. CloudFront and the test server use them. */
export function withImageDelivery(imageUrl: string, width: number): string {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return imageUrl;
  }
  const size = imageDeliverySize({ w: String(width), q: String(IMAGE_DELIVERY_QUALITY) });
  url.searchParams.set('w', String(size.width));
  url.searchParams.set('q', String(size.quality));
  return url.toString();
}
