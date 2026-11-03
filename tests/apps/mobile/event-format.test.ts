import { describe, expect, it } from 'vitest';

import {
  detailBarLink,
  featuredTicketLink,
  participateSheetLinks,
  relativeDateLabel,
  shortDateLabel,
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

describe('detailBarLink', () => {
  it('opens tickets ahead of an info page', () => {
    expect(
      detailBarLink([
        { type: 'info', url: 'https://example.com/about' },
        { type: 'tickets', url: 'https://tickster.com/e/2', label: 'Tickster' },
      ]),
    ).toEqual({ kind: 'tickets', url: 'https://tickster.com/e/2' });
  });

  it('opens the info page when the event has no ticket link', () => {
    expect(
      detailBarLink([
        { type: 'registration', url: 'https://forms.example/join' },
        { type: 'info', url: 'https://example.com/about' },
        { type: 'facebook', url: 'https://facebook.com/event' },
      ]),
    ).toEqual({ kind: 'info', url: 'https://example.com/about' });
  });

  it('asks for a reminder when there is no ticket or info page', () => {
    expect(detailBarLink([])).toEqual({ kind: 'remind' });
    expect(
      detailBarLink([
        { type: 'registration', url: 'https://forms.example/join' },
        { type: 'instagram', url: 'https://instagram.com/place' },
        { type: 'info', url: 'javascript:alert(1)' },
      ]),
    ).toEqual({ kind: 'remind' });
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

  it('does not treat a shop name in the path as the host', () => {
    expect(
      featuredTicketLink(
        [
          { url: 'https://venue.example/show', title: 'Info' },
          { url: 'https://example.com/tickster', title: 'Evenemangslänk' },
        ],
        '150kr',
      )?.url,
    ).toBe('https://venue.example/show');
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

describe('relativeDateLabel', () => {
  const labels = { today: 'Today', tomorrow: 'Tomorrow' };
  const now = new Date('2026-11-02T12:00:00.000Z');
  const zone = 'Europe/Stockholm';

  it('uses today and tomorrow for those calendar days in the event zone', () => {
    expect(relativeDateLabel('2026-11-02T08:00:00.000Z', 'en', labels, now, zone)).toBe('Today');
    expect(relativeDateLabel('2026-11-03T08:00:00.000Z', 'en', labels, now, zone)).toBe('Tomorrow');
    // 23:30 UTC is 00:30 the next day in Stockholm.
    expect(relativeDateLabel('2026-11-02T23:30:00.000Z', 'en', labels, now, zone)).toBe('Tomorrow');
  });

  it('keeps the short date once the occasion is past tomorrow', () => {
    const later = '2026-11-10T08:00:00.000Z';
    expect(relativeDateLabel(later, 'sv', labels, now, zone)).toBe(
      shortDateLabel(later, 'sv', zone),
    );
    const yesterday = '2026-11-01T08:00:00.000Z';
    expect(relativeDateLabel(yesterday, 'sv', labels, now, zone)).toBe(
      shortDateLabel(yesterday, 'sv', zone),
    );
  });

  it('returns nothing when the start is missing', () => {
    expect(relativeDateLabel('', 'sv', labels, now, zone)).toBe('');
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
