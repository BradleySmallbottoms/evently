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
  applyTipAnswers,
  tipCard,
  tipDetailProgress,
  tipTags,
  tipFollowUpQuestion,
  tipOpenAllowed,
  tipSubmissionAllowed,
  tipTranscript,
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

  it('does not ask for a category when the description is present', () => {
    expect(
      needsTipFollowUp({
        path: 'text',
        extraction: { title: 'Konsert', description: 'En kväll' },
        hasImage: true,
      }),
    ).toBe(false);
  });

  it('asks for a description when the chat has not collected one', () => {
    expect(
      needsTipFollowUp({
        path: 'photo',
        extraction: { title: 'Sommarkonsert' },
        hasImage: true,
      }),
    ).toBe(true);
    expect(
      needsTipFollowUp({
        path: 'photo',
        extraction: { title: 'Sommarkonsert', description: 'En kväll', categoryHint: 'Musik' },
        hasImage: true,
      }),
    ).toBe(false);
  });
});

describe('tip tags', () => {
  const catalog = [
    { id: 'musik', name: 'Musik' },
    { id: 'sport', name: 'Sport' },
  ];

  it('keeps catalog names and ids and drops anything else', () => {
    expect(tipTags(['musik', 'sport', 'Påhittad', 'Musik'], catalog)).toEqual(['Musik', 'Sport']);
    expect(mergeTipExtraction({ tags: ['Musik'] }, { title: 'A' }).tags).toEqual(['Musik']);
    expect(mergeTipExtraction({ tags: ['Musik'] }, { tags: ['Sport'] }).tags).toEqual(['Sport']);
    expect(tipCard({ title: 'Konsert', tags: ['Musik'] }).tags).toEqual(['Musik']);
  });
});

describe('tip limits and titles', () => {
  it('stops at the daily submission cap', () => {
    expect(tipSubmissionAllowed(TIP_DAILY_LIMIT - 1)).toEqual({ ok: true });
    expect(tipSubmissionAllowed(TIP_DAILY_LIMIT)).toEqual({ ok: false, reason: 'daily_limit' });
    expect(tipOpenAllowed(TIP_DAILY_LIMIT)).toEqual({ ok: false, reason: 'open_limit' });
    expect(tipDetailProgress({ title: 'Konsert', place: 'Parken' })).toMatchObject({
      done: 2,
      total: 9,
      missing: ['startsAt', 'startTime', 'endsAt', 'endTime', 'price', 'link', 'description'],
    });
    expect(
      tipDetailProgress({
        title: 'Konsert',
        startsAt: '2026-08-24T17:00:00.000Z',
        startTime: '17:00',
        place: 'Parken',
        priceLabel: 'Gratis',
        link: 'https://stad.se',
        description: 'En kväll.',
        categoryHint: 'Musik',
        endsAt: '2026-08-24T19:00:00+02:00',
        endTime: '19:00',
      }).missing,
    ).toEqual([]);
    expect(tipDetailProgress({ startsAt: '2026-08-24T17:00:00.000Z' }).missing).not.toContain(
      'startTime',
    );
    expect(tipDetailProgress({ startsAt: '2026-08-24' }).missing).toContain('startTime');
    expect(tipDetailProgress({ endsAt: '2026-08-24T19:00:00+02:00' }).missing).not.toContain(
      'endTime',
    );
    expect(
      applyTipAnswers({ startsAt: '2026-10-24T19:00:00+02:00' }, 'startDate: 2026-10-24').startsAt,
    ).toContain('2026-10-24T19:00:00');
    expect(
      tipFollowUpQuestion({
        questions: [
          { key: 'link', question: 'Finns det en länk?' },
          { key: 'place', question: 'Var?' },
        ],
        missing: ['link'],
        locale: 'sv',
      }),
    ).toEqual({
      key: 'link',
      question: 'Finns det en länk?',
      options: [
        { label: 'Ja', reply: null },
        { label: 'Nej', reply: 'link: none' },
      ],
    });
    expect(
      tipFollowUpQuestion({
        questions: [{ key: 'date', question: 'När?' }],
        missing: ['place'],
        locale: 'en',
      }),
    ).toEqual({ key: 'place', question: 'Where is the event?', options: [] });
    expect(tipFollowUpQuestion({ questions: [], missing: [], locale: 'sv' })).toBeNull();
    expect(
      tipCard({
        title: 'Konsert',
        summary: '  En kväll med musik i parken.  ',
      }),
    ).toMatchObject({ title: 'Konsert', summary: 'En kväll med musik i parken.' });
    expect(
      tipFollowUpQuestion({ questions: [], missing: [], locale: 'sv', image: 'missing' }),
    ).toEqual({
      key: 'image',
      question: 'Vill du lägga till en bild?',
      options: [],
    });
    expect(applyTipAnswers({}, 'image: none').imageDeclined).toBe(true);
    const unknownEnd = applyTipAnswers({}, 'end: none');
    expect(unknownEnd.endDeclined).toBe(true);
    expect(unknownEnd.endsAt).toBeNull();
    expect(tipDetailProgress(unknownEnd).missing).not.toContain('endsAt');
    expect(tipDetailProgress(unknownEnd).missing).not.toContain('endTime');
    expect(applyTipAnswers({}, 'endDate: 2026-08-24').endsAt).toBe('2026-08-24');
    expect(applyTipAnswers({ endsAt: '2026-08-24' }, 'endTime: 18:00').endsAt).toContain(
      '2026-08-24T18:00:00',
    );
    expect(applyTipAnswers({}, 'startDate: 2026-08-24\nstartTime: 18:00').startsAt).toContain(
      '2026-08-24T18:00:00',
    );
    expect(tipDetailProgress(applyTipAnswers({}, 'startTime: none')).missing).not.toContain(
      'startTime',
    );
    expect(
      tipFollowUpQuestion({
        questions: [],
        missing: ['endsAt', 'endTime'],
        locale: 'sv',
        extraction: {
          title: 'Konsert',
          startsAt: '2026-08-24T17:00:00.000Z',
          place: 'Parken',
        },
      }),
    ).toMatchObject({
      key: 'title',
      question: 'Vi har valt titeln: Konsert. Blir det bra?',
      options: [
        { label: 'Ja', reply: 'confirm: title' },
        { label: 'Nej', reply: null },
      ],
    });
    const acceptedTitle = applyTipAnswers(
      { title: 'Konsert', startsAt: '2026-08-24T17:00:00.000Z', place: 'Parken' },
      'confirm: title',
    );
    expect(acceptedTitle.accepted).toEqual(['title']);
    expect(
      tipFollowUpQuestion({
        questions: [],
        missing: ['endsAt', 'endTime'],
        locale: 'sv',
        extraction: acceptedTitle,
      })?.key,
    ).toBe('startDate');
    expect(
      tipFollowUpQuestion({
        questions: [],
        missing: ['endsAt', 'endTime'],
        locale: 'sv',
        extraction: acceptedTitle,
      })?.question,
    ).toBe('Stämmer det att det börjar 24 augusti 2026?');
    expect(mergeTipExtraction(acceptedTitle, { title: 'Annat', place: 'Torget' }).title).toBe(
      'Konsert',
    );
    expect(mergeTipExtraction(acceptedTitle, { title: 'Annat', place: 'Torget' }).place).toBe(
      'Torget',
    );
    expect(applyTipAnswers({}, 'title: Ny titel').title).toBe('Ny titel');
    expect(applyTipAnswers({}, 'title: Ny titel').accepted).toEqual(['title']);
    expect(tipFollowUpQuestion({ questions: [], missing: ['endsAt'], locale: 'sv' })).toEqual({
      key: 'endDate',
      question: 'Vilket datum slutar evenemanget?',
      options: [{ label: 'Jag vet inte', reply: 'endDate: none' }],
    });
    const declined = applyTipAnswers({ link: 'none' }, 'link: none');
    expect(declined.link).toBeNull();
    expect(declined.linkDeclined).toBe(true);
    expect(tipDetailProgress(declined).missing).not.toContain('link');
    expect(tipDetailProgress(applyTipAnswers({}, 'price: free')).missing).not.toContain('price');
    expect(applyTipAnswers({}, 'price: 150').priceAmount).toBe(15000);
    expect(applyTipAnswers({}, 'date: 2026-08-24').startsAt).toBe('2026-08-24');
    expect(applyTipAnswers({ linkDeclined: true }, 'link: https://stad.se').link).toBe('stad.se');
    expect(
      tipFollowUpQuestion({
        questions: [
          {
            key: 'link',
            question: 'Vilken är länken?',
            options: [{ label: 'Ingen länk', reply: 'link: none' }],
          },
        ],
        missing: ['link'],
        locale: 'sv',
      })?.options,
    ).toEqual([{ label: 'Ingen länk', reply: 'link: none' }]);
    expect(tipTranscript('Första raden', 'Musik')).toBe('Första raden\nMusik');
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
    expect(
      tipPhase({
        path: 'text',
        status: 'collecting',
        scanStatus: null,
        imageStatus: 'none',
        hasExtraction: true,
        detailsComplete: false,
      }),
    ).toBe('collecting');
    expect(
      tipPhase({
        path: 'text',
        status: 'collecting',
        scanStatus: null,
        imageStatus: 'none',
        hasExtraction: true,
        detailsComplete: true,
      }),
    ).toBe('confirm');
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
