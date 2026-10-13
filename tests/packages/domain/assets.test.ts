import {
  deviceAssetUrl,
  publicAssetUrl,
  publicGalleryUrls,
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
    expect(publicGalleryUrls(undefined, [{ role: 'gallery-1', s3Key: 'events/abc/gallery-1' }])).toEqual(
      [],
    );
  });
});

describe('safeAssetKey', () => {
  it('keeps a stored object key and rejects traversal', () => {
    expect(safeAssetKey('events/abc/main')).toBe('events/abc/main');
    expect(safeAssetKey('events/../../secret')).toBeNull();
    expect(safeAssetKey('')).toBeNull();
  });
});
