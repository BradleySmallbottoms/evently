import { describe, expect, it, vi } from 'vitest';
import { handleEventPublished } from '../../../apps/worker/src/notify/handle-published';
import type { ExpoPushClient } from '../../../apps/worker/src/notify/expo-push';
import * as match from '../../../apps/worker/src/notify/match';

const EVENT_ID = '11111111-1111-4111-8111-111111111201';
const USER_ID = '11111111-1111-4111-8111-111111111202';
const DEVICE_ID = '11111111-1111-4111-8111-111111111203';

function mockDb() {
  const tx = { execute: vi.fn(async () => []) };
  return {
    transaction: async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
  } as never;
}

describe('handleEventPublished', () => {
  it('sends Expo push and claims notification for matched users', async () => {
    const send = vi.fn(async () => [{ status: 'ok' as const, id: 'ticket-1' }]);
    const expo: ExpoPushClient = { send };

    vi.spyOn(match, 'loadPublishedEvent').mockResolvedValue({
      id: EVENT_ID,
      title: 'Konsert',
      status: 'published',
      publisherId: '11111111-1111-4111-8111-111111111204',
      hasLocation: true,
      categoryIds: ['cat'],
    });
    vi.spyOn(match, 'findNearbyCandidates').mockResolvedValue([
      {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        expoPushToken: 'ExponentPushToken[abc]',
        locale: 'sv',
        timezone: 'Europe/Stockholm',
        quietHoursStartMin: 22 * 60,
        quietHoursEndMin: 8 * 60,
        quietHoursEnabled: true,
      },
    ]);
    vi.spyOn(match, 'findPublisherSubscriberCandidates').mockResolvedValue([]);
    vi.spyOn(match, 'loadRecentNotificationCounts').mockResolvedValue(new Map());
    const claim = vi.spyOn(match, 'claimNotification').mockResolvedValue('notif-1');
    vi.spyOn(match, 'releaseNotificationClaim').mockResolvedValue();

    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo,
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    });

    expect(result).toEqual({ matched: 1, sent: 1, skipped: 0 });
    expect(claim).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith([
      expect.objectContaining({
        to: 'ExponentPushToken[abc]',
        title: 'Konsert',
        body: 'Ett nytt evenemang nära dig',
        data: { eventId: EVENT_ID, reason: 'nearby' },
      }),
    ]);
  });

  it('skips during quiet hours', async () => {
    const send = vi.fn();
    vi.spyOn(match, 'loadPublishedEvent').mockResolvedValue({
      id: EVENT_ID,
      title: 'Konsert',
      status: 'published',
      publisherId: '11111111-1111-4111-8111-111111111204',
      hasLocation: true,
      categoryIds: ['cat'],
    });
    vi.spyOn(match, 'findNearbyCandidates').mockResolvedValue([
      {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        expoPushToken: 'ExponentPushToken[abc]',
        locale: 'sv',
        timezone: 'Europe/Stockholm',
        quietHoursStartMin: 22 * 60,
        quietHoursEndMin: 8 * 60,
        quietHoursEnabled: true,
      },
    ]);
    vi.spyOn(match, 'findPublisherSubscriberCandidates').mockResolvedValue([]);
    vi.spyOn(match, 'loadRecentNotificationCounts').mockResolvedValue(new Map());

    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo: { send },
      now: () => new Date('2026-06-15T21:30:00.000Z'), // 23:30 CEST
    });

    expect(result).toEqual({ matched: 1, sent: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips geo match for digital events but still checks publisher followers', async () => {
    vi.spyOn(match, 'loadPublishedEvent').mockResolvedValue({
      id: EVENT_ID,
      title: 'Stream',
      status: 'published',
      publisherId: '11111111-1111-4111-8111-111111111204',
      hasLocation: false,
      categoryIds: ['cat'],
    });
    const findNearby = vi.spyOn(match, 'findNearbyCandidates');
    vi.spyOn(match, 'findPublisherSubscriberCandidates').mockResolvedValue([]);
    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo: { send: vi.fn() },
    });
    expect(result.matched).toBe(0);
    expect(findNearby).not.toHaveBeenCalled();
  });

  it('releases claims when Expo returns no tickets', async () => {
    vi.spyOn(match, 'loadPublishedEvent').mockResolvedValue({
      id: EVENT_ID,
      title: 'Konsert',
      status: 'published',
      publisherId: '11111111-1111-4111-8111-111111111204',
      hasLocation: true,
      categoryIds: ['cat'],
    });
    vi.spyOn(match, 'findNearbyCandidates').mockResolvedValue([
      {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        expoPushToken: 'ExponentPushToken[abc]',
        locale: 'sv',
        timezone: 'Europe/Stockholm',
        quietHoursStartMin: 22 * 60,
        quietHoursEndMin: 8 * 60,
        quietHoursEnabled: true,
      },
    ]);
    vi.spyOn(match, 'findPublisherSubscriberCandidates').mockResolvedValue([]);
    vi.spyOn(match, 'loadRecentNotificationCounts').mockResolvedValue(new Map());
    vi.spyOn(match, 'claimNotification').mockResolvedValue('notif-1');
    const release = vi.spyOn(match, 'releaseNotificationClaim').mockResolvedValue();

    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo: { send: vi.fn(async () => []) },
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    });

    expect(result.sent).toBe(0);
    expect(release).toHaveBeenCalledWith(expect.anything(), 'notif-1');
  });
});
