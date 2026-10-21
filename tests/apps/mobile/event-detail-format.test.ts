import { describe, expect, it } from 'vitest';

import {
  descriptionParts,
  formatPeriod,
  isMultiDay,
  isOpenPeriod,
  linkHost,
  periodStatus,
} from '../../../apps/mobile/src/lib/event-detail-format';

const tz = 'Europe/Stockholm';

describe('formatPeriod', () => {
  it('joins two days in the same year', () => {
    expect(formatPeriod('2026-09-19T00:00:00+02:00', '2026-11-15T00:00:00+01:00', 'sv', tz)).toBe(
      '19 sep – 15 nov 2026',
    );
  });

  it('keeps a single calendar day as one date', () => {
    expect(formatPeriod('2026-09-19T08:00:00+02:00', '2026-09-19T16:00:00+02:00', 'sv', tz)).toBe(
      '19 sep 2026',
    );
  });

  it('includes both years when the span crosses a year', () => {
    expect(formatPeriod('2026-12-19T00:00:00+01:00', '2027-01-02T00:00:00+01:00', 'sv', tz)).toBe(
      '19 dec 2026 – 2 jan 2027',
    );
  });
});

describe('isMultiDay', () => {
  it('is false for one calendar day', () => {
    expect(isMultiDay('2026-09-19T08:00:00+02:00', '2026-09-19T16:00:00+02:00', tz)).toBe(false);
  });

  it('is true when the end is another day', () => {
    expect(isMultiDay('2026-09-19T00:00:00+02:00', '2026-11-15T00:00:00+01:00', tz)).toBe(true);
  });
});

describe('isOpenPeriod', () => {
  it('stays one showing when the event only crosses midnight', () => {
    expect(isOpenPeriod('2026-10-18T22:00:00+02:00', '2026-10-19T01:00:00+02:00', tz)).toBe(false);
  });

  it('is a period when it lasts at least a day across calendar days', () => {
    expect(isOpenPeriod('2026-09-19T00:00:00+02:00', '2026-11-15T00:00:00+01:00', tz)).toBe(true);
  });
});

describe('periodStatus', () => {
  it('is ongoing on a day inside the span, including the end day', () => {
    expect(
      periodStatus(
        '2026-09-19T00:00:00+02:00',
        '2026-11-15T00:00:00+01:00',
        new Date('2026-10-18T12:00:00+02:00'),
        tz,
      ),
    ).toBe('now');
    expect(
      periodStatus(
        '2026-09-19T00:00:00+02:00',
        '2026-11-15T00:00:00+01:00',
        new Date('2026-11-15T18:00:00+01:00'),
        tz,
      ),
    ).toBe('now');
  });

  it('is upcoming before the start and past after the end day', () => {
    expect(
      periodStatus(
        '2026-09-19T00:00:00+02:00',
        '2026-11-15T00:00:00+01:00',
        new Date('2026-09-01T12:00:00+02:00'),
        tz,
      ),
    ).toBe('soon');
    expect(
      periodStatus(
        '2026-09-19T00:00:00+02:00',
        '2026-11-15T00:00:00+01:00',
        new Date('2026-11-16T12:00:00+01:00'),
        tz,
      ),
    ).toBe('past');
  });
});

describe('descriptionParts', () => {
  it('keeps a short description as the lead only', () => {
    expect(descriptionParts('En kort text.')).toEqual({ lead: 'En kort text.', about: '' });
  });

  it('splits a long description after the first sentence', () => {
    const description = `${'Upptäck naturen. '}${'Mer text om leden. '.repeat(20)}`;
    const parts = descriptionParts(description);
    expect(parts.lead).toBe('Upptäck naturen.');
    expect(parts.about.startsWith('Mer text')).toBe(true);
  });

  it('truncates a lead when the first sentence is very long', () => {
    const description = `${'a'.repeat(220)}. Resten.`;
    const parts = descriptionParts(description);
    expect(parts.lead.endsWith('…')).toBe(true);
    expect(parts.about.startsWith('aaa')).toBe(true);
  });
});

describe('linkHost', () => {
  it('drops a leading www', () => {
    expect(linkHost('https://www.naturkartan.se/path')).toBe('naturkartan.se');
  });

  it('returns null for a value that is not a url', () => {
    expect(linkHost('not a url')).toBeNull();
  });
});
