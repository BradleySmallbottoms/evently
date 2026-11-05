import {
  copyEventImage,
  eventImageKey,
  isPublicHttpsImageUrl,
} from '../../../apps/data-workers/src/event-images';
import { describe, expect, it } from 'vitest';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function response(body: string, status: number, contentType: string): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('copyEventImage', () => {
  it('stores a small image under events/{id}/main', async () => {
    const puts: { key: string; contentType: string; bytes: number }[] = [];
    const stored = await copyEventImage({
      eventId: EVENT_ID,
      sourceUrl: 'https://images.example/bandy.jpg',
      fetchImpl: async () => response('jpeg-bytes', 200, 'image/jpeg; charset=binary'),
      put: async (body, contentType, key) => {
        puts.push({ key, contentType, bytes: body.byteLength });
      },
    });
    expect(stored).toEqual({ s3Key: eventImageKey(EVENT_ID), contentType: 'image/jpeg' });
    expect(puts).toEqual([
      { key: `events/${EVENT_ID}/main`, contentType: 'image/jpeg', bytes: 10 },
    ]);
    expect(eventImageKey(EVENT_ID, 'gallery-1')).toBe(`events/${EVENT_ID}/gallery-1`);
    expect(() => eventImageKey(EVENT_ID, '../main')).toThrow(/role/);
  });

  it('does not fetch a private or non-https URL', async () => {
    const refused = [
      'http://127.0.0.1/secret',
      'https://[::ffff:127.0.0.1]/secret',
      'https://[::ffff:10.0.0.1]/secret',
      'https://[::7f00:1]/secret',
      'https://100.64.0.1/meta',
    ];
    for (const sourceUrl of refused) {
      expect(isPublicHttpsImageUrl(sourceUrl)).toBe(false);
      const local = await copyEventImage({
        eventId: EVENT_ID,
        sourceUrl,
        fetchImpl: async () => {
          throw new Error('should not fetch');
        },
        put: async () => {
          throw new Error('should not put');
        },
      });
      expect(local).toBeNull();
    }
    expect(isPublicHttpsImageUrl('https://[::ffff:8.8.8.8]/ok')).toBe(true);
  });

  it('rejects a non-image and an oversized body', async () => {
    const html = await copyEventImage({
      eventId: EVENT_ID,
      sourceUrl: 'https://images.example/page',
      fetchImpl: async () => response('<html>', 200, 'text/html'),
      put: async () => {
        throw new Error('should not put');
      },
    });
    expect(html).toBeNull();

    const huge = await copyEventImage({
      eventId: EVENT_ID,
      sourceUrl: 'https://images.example/huge.jpg',
      fetchImpl: async () => response('x'.repeat(8 * 1024 * 1024 + 1), 200, 'image/png'),
      put: async () => {
        throw new Error('should not put');
      },
    });
    expect(huge).toBeNull();
  });
});
