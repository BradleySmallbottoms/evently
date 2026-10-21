import { describe, expect, it } from 'vitest';
import {
  fallbackTipTitle,
  hasUsableTitle,
  mergeTipExtraction,
  needsTipFollowUp,
  tipImageAllowed,
  tipInstant,
  tipOrganizerKeys,
  tipPhase,
  tipScanNotification,
  tipOpenAllowed,
  tipSubmissionAllowed,
  TIP_DAILY_LIMIT,
  TIP_IMAGE_MAX_BYTES,
} from '../../../packages/domain/src/tips';

describe('tip extraction', () => {
  it('keeps a filled field when a later patch is empty', () => {
    const merged = mergeTipExtraction(
      { title: 'Sommarkonsert', place: 'Stadsparken' },
      { title: '  ', place: 'Söderhamn' },
    );
    expect(merged.title).toBe('Sommarkonsert');
    expect(merged.place).toBe('Söderhamn');
  });

  it('treats a free-entry label as price 0', () => {
    expect(mergeTipExtraction({}, { priceLabel: 'Gratis' }).priceAmount).toBe(0);
  });

  it('asks a text tip for the follow-up when the category is missing', () => {
    expect(
      needsTipFollowUp({
        path: 'text',
        extraction: { title: 'Konsert', description: 'En kväll' },
        hasImage: true,
      }),
    ).toBe(true);
    expect(
      needsTipFollowUp({
        path: 'text',
        extraction: { title: 'Konsert', description: 'En kväll', categoryHint: 'Musik' },
        hasImage: true,
      }),
    ).toBe(false);
  });

  it('lets a photo with a title skip the follow-up', () => {
    expect(
      needsTipFollowUp({
        path: 'photo',
        extraction: { title: 'Sommarkonsert' },
        hasImage: true,
      }),
    ).toBe(false);
    expect(needsTipFollowUp({ path: 'photo', extraction: {}, hasImage: true })).toBe(true);
  });
});

describe('tip limits and titles', () => {
  it('stops at the daily submission cap', () => {
    expect(tipSubmissionAllowed(TIP_DAILY_LIMIT - 1)).toEqual({ ok: true });
    expect(tipSubmissionAllowed(TIP_DAILY_LIMIT)).toEqual({ ok: false, reason: 'daily_limit' });
    expect(tipOpenAllowed(TIP_DAILY_LIMIT)).toEqual({ ok: false, reason: 'open_limit' });
  });

  it('rejects an oversized or unknown image', () => {
    expect(
      tipImageAllowed({ contentType: 'image/jpeg', byteLength: 10, existingCount: 0 }),
    ).toEqual({
      ok: true,
    });
    expect(
      tipImageAllowed({
        contentType: 'image/jpeg',
        byteLength: TIP_IMAGE_MAX_BYTES + 1,
        existingCount: 0,
      }),
    ).toEqual({ ok: false, reason: 'too_large' });
    expect(tipImageAllowed({ contentType: 'image/gif', byteLength: 10, existingCount: 0 })).toEqual(
      {
        ok: false,
        reason: 'unsupported_type',
      },
    );
  });

  it('falls back to the first line, then a localized title', () => {
    expect(fallbackTipTitle({ title: 'Konsert', locale: 'sv' })).toBe('Konsert');
    expect(fallbackTipTitle({ text: 'Marknad i parken\nmer text', locale: 'sv' })).toBe(
      'Marknad i parken',
    );
    expect(fallbackTipTitle({ locale: 'en' })).toBe('Tipped event');
    expect(hasUsableTitle({ title: 'A' })).toBe(false);
  });

  it('reads only an ISO start as an instant', () => {
    expect(tipInstant('Lör 24 aug 2026, 19:00')).toBeNull();
    expect(tipInstant('2026-08-24T17:00:00.000Z')?.toISOString()).toBe('2026-08-24T17:00:00.000Z');
  });

  it('always has an organizer key', () => {
    expect(tipOrganizerKeys({ tipId: '11111111-1111-4111-8111-111111111111' })).toEqual([
      'tip:11111111-1111-4111-8111-111111111111',
    ]);
  });
});

describe('tip phase and notification copy', () => {
  it('shows the published screen only after a published scan', () => {
    expect(
      tipPhase({
        path: 'photo',
        status: 'scanned',
        scanStatus: 'published',
        imageStatus: 'ready',
        hasExtraction: true,
      }),
    ).toBe('published');
    expect(
      tipPhase({
        path: 'text',
        status: 'scanned',
        scanStatus: 'in_review',
        imageStatus: 'none',
        hasExtraction: true,
      }),
    ).toBe('review');
  });

  it('says the event was added only when it is published', () => {
    const published = tipScanNotification({
      locale: 'sv',
      status: 'published',
      title: 'Sommarkonsert',
      place: 'Stadsparken',
    });
    expect(published.title).toBe('Ditt event är klart!');
    expect(published.body).toContain('Sommarkonsert');
    const review = tipScanNotification({
      locale: 'sv',
      status: 'in_review',
      title: 'Sommarkonsert',
      place: null,
    });
    expect(review.body).not.toContain('lagt till');
  });
});
