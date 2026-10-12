import { describe, expect, it } from 'vitest';

import {
  buildEventWebUrl,
  eventShareContent,
  eventShareMessage,
  webBaseUrl,
} from '../../../apps/mobile/src/lib/event-share-url';

describe('event-share', () => {
  it('builds a web event URL without a locale prefix', () => {
    expect(buildEventWebUrl('abc-123', 'https://events.example.com')).toBe(
      'https://events.example.com/events/abc-123',
    );
  });

  it('strips a trailing slash on the web origin', () => {
    expect(buildEventWebUrl('abc-123', 'https://events.example.com/')).toBe(
      'https://events.example.com/events/abc-123',
    );
  });

  it('encodes the event id in the path', () => {
    expect(buildEventWebUrl('a/b', 'https://events.example.com')).toBe(
      'https://events.example.com/events/a%2Fb',
    );
  });

  it('falls back to local web in development when the env URL is missing or invalid', () => {
    expect(webBaseUrl(undefined)).toBe('http://localhost:3100');
    expect(webBaseUrl('not a url')).toBe('http://localhost:3100');
  });

  it('puts the event URL in the shared text', () => {
    const url = 'https://events.example.com/events/abc-123';
    expect(eventShareMessage('Jazz på Bryggan', url)).toBe(`Jazz på Bryggan\n${url}`);
    expect(eventShareMessage('  ', url)).toBe(url);
  });

  it('shares the event link on iOS and Android', () => {
    const url = 'https://events.example.com/events/abc-123';
    const ios = eventShareContent('Jazz på Bryggan', url, 'ios');
    const android = eventShareContent('Jazz på Bryggan', url, 'android');
    expect(ios).toEqual({ url });
    expect(android.message).toContain(url);
    expect(android.url).toBeUndefined();
  });

  it('throws outside development when the env URL is missing', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => webBaseUrl(undefined)).toThrow(/EXPO_PUBLIC_WEB_URL/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
