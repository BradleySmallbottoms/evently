import { describe, expect, it } from 'vitest';
import {
  canAddListItem,
  canCreateAnotherList,
  mergeImportedLinks,
  parseLinksFromText,
  selectPrimaryLink,
} from '../../../packages/domain/src/index';

describe('selectPrimaryLink', () => {
  const links = [
    { type: 'info' as const, url: 'https://example.com/info', label: 'Mer' },
    { type: 'tickets' as const, url: 'https://example.com/tickets', label: 'Biljetter' },
    { type: 'registration' as const, url: 'https://example.com/signup' },
  ];

  it('prefers tickets, then registration, then the online url, then info', () => {
    expect(selectPrimaryLink(links, 'https://example.com/live')?.kind).toBe('tickets');
    expect(selectPrimaryLink(links.slice(0, 1).concat(links[2]!), null)?.url).toBe(
      'https://example.com/signup',
    );
    expect(selectPrimaryLink([links[0]!], 'https://example.com/live')).toEqual({
      kind: 'online',
      url: 'https://example.com/live',
      label: null,
    });
    expect(selectPrimaryLink([links[0]!], null)?.kind).toBe('info');
    expect(selectPrimaryLink([], null)).toBeNull();
  });
});

describe('parseLinksFromText', () => {
  it('reads anchors, markdown, and bare urls, and skips images', () => {
    const links = parseLinksFromText(
      [
        '<a href="https://tickets.example/show">Biljetter</a>',
        '[Anmälan](https://forms.example/join)',
        'Mer info: https://example.com/about.',
        '<img src="https://images.example/hero.jpg">',
      ].join('\n'),
    );
    expect(links).toEqual([
      { type: 'tickets', url: 'https://tickets.example/show', label: 'Biljetter' },
      { type: 'registration', url: 'https://forms.example/join', label: 'Anmälan' },
      { type: 'info', url: 'https://example.com/about' },
    ]);
  });
});

describe('mergeImportedLinks', () => {
  it('keeps adapter links and appends new description links once', () => {
    expect(
      mergeImportedLinks(
        [{ type: 'tickets', url: 'https://brobergsoderhamn.ticketco.events/se/sv' }],
        'Se https://brobergsoderhamn.ticketco.events/se/sv/ och https://example.com/about',
      ),
    ).toEqual([
      { type: 'tickets', url: 'https://brobergsoderhamn.ticketco.events/se/sv' },
      { type: 'info', url: 'https://example.com/about' },
    ]);
  });

  it('treats a trailing slash as the same link', () => {
    expect(
      mergeImportedLinks(
        [{ type: 'info', url: 'https://example.com/event' }],
        'https://example.com/event/',
      ),
    ).toEqual([{ type: 'info', url: 'https://example.com/event' }]);
  });
});

describe('list caps', () => {
  it('allows up to 20 lists and 100 events in a list', () => {
    expect(canCreateAnotherList(19)).toBe(true);
    expect(canCreateAnotherList(20)).toBe(false);
    expect(canAddListItem(99)).toBe(true);
    expect(canAddListItem(100)).toBe(false);
  });
});
