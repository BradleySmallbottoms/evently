import { describe, expect, it } from 'vitest';

import {
  groupNotifications,
  notificationPresentation,
  notificationText,
  notificationWhen,
} from '../../../apps/mobile/src/lib/notification-sheet';

const now = new Date('2026-06-15T12:00:00.000Z');

describe('notification sheet grouping', () => {
  it('maps a reason and tip state onto a card', () => {
    expect(notificationPresentation({ reason: 'tip', tipStatus: 'published' })).toBe(
      'tip_published',
    );
    expect(notificationPresentation({ reason: 'tip', tipStatus: 'in_review' })).toBe(
      'tip_approved',
    );
    expect(notificationPresentation({ reason: 'tip', tipStatus: 'needs_input' })).toBe(
      'tip_needs_input',
    );
    expect(notificationPresentation({ reason: 'tip', tipStatus: 'failed' })).toBe('tip_failed');
    expect(notificationPresentation({ reason: 'nearby' })).toBe('new_event');
    expect(notificationPresentation({ reason: 'publisher' })).toBe('new_event');
    expect(notificationPresentation({ reason: 'event' })).toBe('event_updated');
    expect(notificationPresentation({ reason: 'broadcast' })).toBe('broadcast');
  });

  it('uses the push copy for the open language', () => {
    const item = {
      titleSv: 'Ditt tips har publicerats',
      titleEn: 'Your tip was published',
      bodySv: 'Ditt evenemang är nu synligt.',
      bodyEn: 'Your event is now visible.',
    };
    expect(notificationText(item, 'sv').title).toBe('Ditt tips har publicerats');
    expect(notificationText(item, 'en').message).toBe('Your event is now visible.');
  });

  it('groups rows into today, yesterday, and earlier', () => {
    const recent = '2026-06-15T11:55:00.000Z';
    const today = '2026-06-15T08:24:00.000Z';
    const yesterday = '2026-06-14T16:00:00.000Z';
    const earlier = '2026-10-20T10:30:00.000Z';
    expect(notificationWhen(recent, 'sv', now)).toEqual({ kind: 'minutes', count: 5 });
    expect(notificationWhen(today, 'sv', now)).toEqual({ kind: 'today', time: '10:24' });
    expect(notificationWhen(yesterday, 'sv', now)).toEqual({ kind: 'yesterday', time: '18:00' });
    expect(notificationWhen(earlier, 'sv', now)).toMatchObject({
      kind: 'earlier',
      time: '12:30',
    });
    expect(
      groupNotifications(
        [{ createdAt: earlier }, { createdAt: recent }, { createdAt: yesterday }],
        now,
      ),
    ).toEqual([
      { id: 'today', items: [{ createdAt: recent }] },
      { id: 'yesterday', items: [{ createdAt: yesterday }] },
      { id: 'earlier', items: [{ createdAt: earlier }] },
    ]);
  });
});
