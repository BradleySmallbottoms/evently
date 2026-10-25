/** True for loopback and `*.localhost`, which a phone cannot open. */
export function isLocalAssetHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
  );
}

/**
 * Object key safe to append to the configured asset origin.
 * Rejects traversal and anything that is not a path segment we store.
 */
export function safeAssetKey(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.length === 0 || decoded.length > 512) return null;
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  const parts = decoded.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === '.' || part === '..')) return null;
  if (!parts.every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) return null;
  return parts.join('/');
}

/**
 * Phones cannot resolve Garage's `*.localhost` website. Point those URLs at the
 * API the app already uses (`GET /v1/assets/…`). Other hosts stay unchanged.
 */
export function deviceAssetUrl(imageUrl: string, apiUrl: string): string {
  let asset: URL;
  let api: URL;
  try {
    asset = new URL(imageUrl);
    api = new URL(apiUrl);
  } catch {
    return imageUrl;
  }
  if (!isLocalAssetHost(asset.hostname)) return imageUrl;
  const prefix = api.pathname.replace(/\/$/, '');
  return `${api.origin}${prefix}/assets${asset.pathname}${asset.search}`;
}

/** Public URL for an object key. `base` is Garage or CloudFront, with no trailing slash. */
export function publicAssetUrl(
  base: string | undefined,
  key: string | null | undefined,
): string | null {
  const trimmed = base?.trim().replace(/\/$/, '');
  if (!trimmed || !key) return null;
  const path = key
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${trimmed}/${path}`;
}

/** `event_images.role` for the sponsored poster. */
export const POSTER_IMAGE_ROLE = 'poster';

const POSTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Eight megabytes. A poster is one image, not a document. */
export const POSTER_MAX_BYTES = 8_000_000;

function startsWith(body: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (body.byteLength < offset + bytes.length) return false;
  return bytes.every((byte, index) => body[offset + index] === byte);
}

/** The declared type has to match the file header, so a renamed file is not stored as an image. */
function posterBytesMatch(type: string, body: Uint8Array): boolean {
  if (type === 'image/jpeg') return startsWith(body, [0xff, 0xd8, 0xff]);
  if (type === 'image/png')
    return startsWith(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === 'image/webp') {
    return (
      startsWith(body, [0x52, 0x49, 0x46, 0x46]) && startsWith(body, [0x57, 0x45, 0x42, 0x50], 8)
    );
  }
  return false;
}

/** Why a poster upload cannot be stored. Null when the file is acceptable. */
export function posterImageError(
  contentType: string,
  body: Uint8Array,
): 'unsupported_type' | 'too_large' | null {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!POSTER_TYPES.has(type)) return 'unsupported_type';
  if (body.byteLength < 1 || body.byteLength > POSTER_MAX_BYTES) return 'too_large';
  if (!posterBytesMatch(type, body)) return 'unsupported_type';
  return null;
}

/** Public URL for the `poster` row. Null when that role is missing. */
export function publicPosterUrl(
  base: string | undefined,
  images: readonly { role: string; s3Key: string }[],
): string | null {
  const key = images.find((image) => image.role === POSTER_IMAGE_ROLE)?.s3Key;
  return publicAssetUrl(base, key);
}

const galleryRole = /^gallery-(\d+)$/;

/** Public URLs for `gallery-N` rows, lowest N first. The hero role is ignored. */
export function publicGalleryUrls(
  base: string | undefined,
  images: readonly { role: string; s3Key: string }[],
): string[] {
  return images
    .flatMap((image) => {
      const match = galleryRole.exec(image.role);
      if (!match) return [];
      const url = publicAssetUrl(base, image.s3Key);
      if (!url) return [];
      return [{ index: Number(match[1]), url }];
    })
    .sort((a, b) => a.index - b.index)
    .map((image) => image.url);
}
