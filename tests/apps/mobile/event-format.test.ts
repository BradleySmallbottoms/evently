import { describe, expect, it } from 'vitest';

import {
  featuredTicketLink,
  participateSheetLinks,
  ticketLink,
} from '../../../apps/mobile/src/lib/event-format';

describe('ticketLink', () => {
  it('returns the first safe tickets url and its label', () => {
    expect(
      ticketLink([
        { type: 'info', url: 'https://example.com/about' },
        { type: 'tickets', url: 'https://nortic.se/ticket/1', label: 'Nortic' },
        { type: 'tickets', url: 'https://tickster.com/e/2' },
      ]),
    ).toEqual({ url: 'https://nortic.se/ticket/1', label: 'Nortic' });
  });

  it('skips a tickets url that is not http(s) and ignores registration', () => {
    expect(
      ticketLink([
        { type: 'tickets', url: 'javascript:alert(1)' },
        { type: 'registration', url: 'https://forms.example/join' },
        { type: 'tickets', url: 'https://tickster.com/e/2', label: null },
      ]),
    ).toEqual({ url: 'https://tickster.com/e/2', label: null });
  });

  it('returns null when the event has no tickets link', () => {
    expect(ticketLink([{ type: 'info', url: 'https://example.com' }])).toBeNull();
    expect(ticketLink([])).toBeNull();
  });

  it('prefers the ticket shop when the event has a price', () => {
    expect(
      ticketLink(
        [
          { type: 'tickets', url: 'https://riksteatern.se/show', label: 'Evenemangslänk' },
          { type: 'tickets', url: 'https://secure.tickster.com/abc', label: 'Tickster' },
        ],
        '150kr',
      ),
    ).toEqual({ url: 'https://secure.tickster.com/abc', label: 'Tickster' });
  });
});

describe('featuredTicketLink', () => {
  const links = [
    { url: 'https://riksteatern.se/show', title: 'Evenemangslänk', detail: 'riksteatern.se' },
    { url: 'https://secure.tickster.com/abc', title: 'Tickster', detail: 'secure.tickster.com' },
    { url: 'https://secure.tickster.com/later', title: 'Tickster', detail: 'secure.tickster.com' },
  ];

  it('puts a priced ticket shop first and keeps the other shops in order', () => {
    expect(featuredTicketLink(links, '150kr')?.url).toBe('https://secure.tickster.com/abc');
  });

  it('keeps the original first link when the event has no price', () => {
    expect(featuredTicketLink(links, null)?.url).toBe('https://riksteatern.se/show');
  });

  it('puts a link that states its own price first', () => {
    expect(
      featuredTicketLink(
        [
          { url: 'https://example.com/a', title: 'Info' },
          { url: 'https://example.com/b', title: 'Biljett 80 kr' },
        ],
        null,
      )?.url,
    ).toBe('https://example.com/b');
  });
});

describe('participateSheetLinks', () => {
  it('keeps tickets apart from the event links and adds the online page', () => {
    expect(
      participateSheetLinks(
        [
          { type: 'tickets', url: 'https://nortic.se/ticket/1', label: 'Nortic' },
          { type: 'info', url: 'https://andreas.se/live' },
          { type: 'registration', url: 'javascript:alert(1)' },
          { type: 'facebook', url: 'https://facebook.com/show', label: null },
        ],
        'https://live.example/room',
      ),
    ).toEqual({
      tickets: [{ type: 'tickets', url: 'https://nortic.se/ticket/1', label: 'Nortic' }],
      event: [
        { type: 'info', url: 'https://andreas.se/live', label: null },
        { type: 'facebook', url: 'https://facebook.com/show', label: null },
        { type: 'online', url: 'https://live.example/room', label: null },
      ],
    });
  });
});
