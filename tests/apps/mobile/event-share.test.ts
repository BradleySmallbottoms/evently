import { describe, expect, it } from 'vitest';

import { facebookReturnPath } from '../../../apps/mobile/src/lib/facebook-return';
import {
  eventOutboundUrl,
  facebookPostUrl,
  facebookShareTarget,
  facebookWebSharerUrl,
} from '../../../apps/mobile/src/lib/facebook-share-target';
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
    expect(webBaseUrl(undefined)).toBe('http://localhost:13100');
    expect(webBaseUrl('not a url')).toBe('http://localhost:13100');
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

  it('opens the Facebook app only when the native credentials are set', () => {
    expect(
      facebookShareTarget({
        appId: '1234567890',
        clientToken: 'token',
        platform: 'ios',
      }),
    ).toBe('dialog');
    expect(
      facebookShareTarget({
        appId: '1234567890',
        clientToken: 'token',
        platform: 'android',
      }),
    ).toBe('dialog');
    expect(
      facebookShareTarget({ appId: '1234567890', clientToken: 'token', platform: 'web' }),
    ).toBe('browser');
    expect(facebookShareTarget({ appId: '  ', clientToken: 'token', platform: 'ios' })).toBe(
      'browser',
    );
    expect(facebookShareTarget({ appId: 'not-an-id', clientToken: 'token', platform: 'ios' })).toBe(
      'browser',
    );
    expect(facebookShareTarget({ appId: '1234567890', platform: 'ios' })).toBe('browser');
  });

  it('links a Facebook post to tickets, then the event page, then the web app', () => {
    const webAppUrl = 'https://app.example.com/events/abc';
    const links = [
      { type: 'facebook', url: 'https://facebook.com/organizer' },
      { type: 'info', url: 'https://venue.example/event' },
      { type: 'tickets', url: 'https://tickets.example/show' },
    ];
    expect(facebookPostUrl({ links, webAppUrl })).toBe('https://tickets.example/show');
    expect(facebookPostUrl({ links: links.slice(0, 2), webAppUrl })).toBe(
      'https://venue.example/event',
    );
    expect(facebookPostUrl({ links: [], webAppUrl })).toBe(webAppUrl);
    expect(
      facebookPostUrl({
        links: [{ type: 'info', url: 'javascript:alert(1)' }],
        webAppUrl,
      }),
    ).toBe(webAppUrl);
    expect(facebookPostUrl({ links: [], webAppUrl: null })).toBeNull();
  });

  it('uses the same link for Messenger and the share sheet', () => {
    expect(
      eventOutboundUrl({
        eventId: 'abc',
        links: [{ type: 'tickets', url: 'https://tickets.example/show' }],
      }),
    ).toBe('https://tickets.example/show');
    expect(eventOutboundUrl({ eventId: 'abc', links: [] })).toBe(buildEventWebUrl('abc'));
  });

  it('keeps the open screen when Facebook returns from a discarded post', () => {
    expect(facebookReturnPath('fb1234567890://bridge/share', false)).toBeNull();
    expect(facebookReturnPath('fb1234567890://', true)).toBe('/');
    expect(facebookReturnPath('/events/abc', false)).toBe('/events/abc');
  });

  it('builds the browser Facebook sharer from the event URL', () => {
    expect(facebookWebSharerUrl('https://events.example.com/events/a b')).toBe(
      'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fevents.example.com%2Fevents%2Fa%20b',
    );
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
