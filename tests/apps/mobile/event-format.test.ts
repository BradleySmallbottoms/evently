import { describe, expect, it } from 'vitest';

import { ticketLink } from '../../../apps/mobile/src/lib/event-format';

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
});
