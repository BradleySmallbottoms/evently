import { describe, expect, it } from 'vitest';

import {
  eventIdFromNotificationData,
  tipIdFromNotificationData,
} from '../../../apps/mobile/src/lib/notification-target';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

describe('eventIdFromNotificationData', () => {
  it('opens the event for reminder, inbox, and local inbox taps', () => {
    expect(eventIdFromNotificationData({ kind: 'reminder', eventId: EVENT_ID })).toBe(EVENT_ID);
    expect(eventIdFromNotificationData({ kind: 'inbox', eventId: EVENT_ID })).toBe(EVENT_ID);
    expect(eventIdFromNotificationData({ kind: 'local_inbox', eventId: ` ${EVENT_ID} ` })).toBe(
      EVENT_ID,
    );
  });

  it('ignores broadcasts and payloads without an event id', () => {
    expect(eventIdFromNotificationData({ kind: 'inbox', eventId: '' })).toBeNull();
    expect(eventIdFromNotificationData({ kind: 'inbox', eventId: '   ' })).toBeNull();
    expect(eventIdFromNotificationData({ kind: 'inbox', eventId: '../profile' })).toBeNull();
    expect(eventIdFromNotificationData({ kind: 'local_inbox' })).toBeNull();
    expect(eventIdFromNotificationData({ kind: 'other', eventId: EVENT_ID })).toBeNull();
    expect(eventIdFromNotificationData(null)).toBeNull();
    expect(
      eventIdFromNotificationData({ kind: 'tip_scan', eventId: EVENT_ID, tipId: EVENT_ID }),
    ).toBeNull();
  });
});

describe('tipIdFromNotificationData', () => {
  it('opens the tip screen and ignores other kinds', () => {
    expect(tipIdFromNotificationData({ kind: 'tip_scan', tipId: EVENT_ID })).toBe(EVENT_ID);
    expect(tipIdFromNotificationData({ kind: 'inbox', tipId: EVENT_ID })).toBeNull();
    expect(tipIdFromNotificationData({ kind: 'tip_scan', tipId: '../tips' })).toBeNull();
    expect(tipIdFromNotificationData(null)).toBeNull();
  });
});
