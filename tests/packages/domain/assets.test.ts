import {
  deviceAssetUrl,
  posterImageError,
  POSTER_MAX_BYTES,
  publicAssetUrl,
  publicGalleryUrls,
  publicPosterUrl,
  safeAssetKey,
} from '../../../packages/domain/src/assets';
import { describe, expect, it } from 'vitest';

describe('publicAssetUrl', () => {
  it('joins the public origin and the object key', () => {
    expect(publicAssetUrl('http://local-events-assets.localhost:3902/', 'events/abc/main')).toBe(
      'http://local-events-assets.localhost:3902/events/abc/main',
    );
    expect(publicAssetUrl('https://d111.cloudfront.net', 'events/a b/main')).toBe(
      'https://d111.cloudfront.net/events/a%20b/main',
    );
  });

  it('returns null when the origin or the key is missing', () => {
    expect(publicAssetUrl(undefined, 'events/abc/main')).toBeNull();
    expect(publicAssetUrl('https://d111.cloudfront.net', null)).toBeNull();
  });
});

describe('deviceAssetUrl', () => {
  it('sends local Garage URLs through the API the phone already reaches', () => {
    expect(
      deviceAssetUrl(
        'http://local-events-assets.localhost:3902/events/abc/main',
        'http://192.168.4.235:3000/v1',
      ),
    ).toBe('http://192.168.4.235:3000/v1/assets/events/abc/main');
  });

  it('leaves CloudFront URLs alone', () => {
    const url = 'https://d111.cloudfront.net/events/abc/main';
    expect(deviceAssetUrl(url, 'http://192.168.4.235:3000/v1')).toBe(url);
  });
});

describe('publicGalleryUrls', () => {
  const base = 'https://d111.cloudfront.net';

  it('returns gallery roles in numeric order and skips the hero', () => {
    expect(
      publicGalleryUrls(base, [
        { role: 'gallery-2', s3Key: 'events/abc/gallery-2' },
        { role: 'main', s3Key: 'events/abc/main' },
        { role: 'gallery-10', s3Key: 'events/abc/gallery-10' },
        { role: 'gallery-1', s3Key: 'events/abc/gallery-1' },
      ]),
    ).toEqual([
      'https://d111.cloudfront.net/events/abc/gallery-1',
      'https://d111.cloudfront.net/events/abc/gallery-2',
      'https://d111.cloudfront.net/events/abc/gallery-10',
    ]);
  });

  it('returns nothing when the public origin is unset', () => {
    expect(
      publicGalleryUrls(undefined, [{ role: 'gallery-1', s3Key: 'events/abc/gallery-1' }]),
    ).toEqual([]);
  });
});

describe('publicPosterUrl', () => {
  it('returns the poster role and ignores the hero', () => {
    expect(
      publicPosterUrl('https://d111.cloudfront.net', [
        { role: 'main', s3Key: 'events/abc/main' },
        { role: 'poster', s3Key: 'events/abc/poster' },
      ]),
    ).toBe('https://d111.cloudfront.net/events/abc/poster');
    expect(publicPosterUrl('https://d111.cloudfront.net', [])).toBeNull();
  });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe('posterImageError', () => {
  it('accepts a jpeg, png, or webp whose header matches the type', () => {
    expect(posterImageError('image/jpeg', JPEG)).toBeNull();
    expect(posterImageError('image/png; charset=binary', PNG)).toBeNull();
    expect(posterImageError('image/webp', WEBP)).toBeNull();
  });

  it('rejects another type, a mismatched header, or an empty or oversized file', () => {
    expect(posterImageError('image/gif', JPEG)).toBe('unsupported_type');
    expect(posterImageError('image/jpeg', PNG)).toBe('unsupported_type');
    expect(posterImageError('image/jpeg', new Uint8Array())).toBe('too_large');
    expect(posterImageError('image/jpeg', new Uint8Array(POSTER_MAX_BYTES + 1))).toBe('too_large');
  });
});

describe('safeAssetKey', () => {
  it('keeps a stored object key and rejects traversal', () => {
    expect(safeAssetKey('events/abc/main')).toBe('events/abc/main');
    expect(safeAssetKey('events/../../secret')).toBeNull();
    expect(safeAssetKey('')).toBeNull();
  });
});
