import { organizerKeys } from '../../../packages/domain/src/organizer-keys';
import { describe, expect, it } from 'vitest';

describe('organizerKeys', () => {
  it('orders a source id, then email, website, and name', () => {
    expect(
      organizerKeys({
        ids: ['org-1'],
        emails: ['Info@Example.com'],
        infoUrls: ['https://www.example.com/about', 'https://facebook.com/example'],
        names: ['Example AB'],
        fallback: 'visit-soderhamn',
      }),
    ).toEqual(['org-1', 'info@example.com', 'example.com/about', 'example.com', 'example ab']);
  });

  it('skips ticket shops, the source site, and a repeated host', () => {
    expect(
      organizerKeys({
        infoUrls: [
          'https://brobergsoderhamn.se/',
          'https://www.brobergsoderhamn.se/lag',
          'https://www.nortic.se/ticket/event/82243',
          'https://visit.destinationhalsingland.se/sv/event',
          'https://images.citybreakcdn.com/image.aspx?ImageId=1',
        ],
        skipHosts: ['visit.destinationhalsingland.se'],
        fallback: 'destination-halsingland',
      }),
    ).toEqual(['brobergsoderhamn.se/lag', 'brobergsoderhamn.se']);
  });

  it('strips a trailing town and ignores a name that is an email', () => {
    expect(
      organizerKeys({
        names: ['Mobackes Trädgårdscenter, Bollnäs', 'kansli@example.com'],
        town: 'Bollnäs',
        fallback: 'destination-halsingland',
      }),
    ).toEqual(['mobackes trädgårdscenter']);
  });

  it('uses the source slug only when nothing else is known', () => {
    expect(organizerKeys({ emails: ['not-an-email'], fallback: 'glada-hudik' })).toEqual([
      'glada-hudik',
    ]);
  });
});
