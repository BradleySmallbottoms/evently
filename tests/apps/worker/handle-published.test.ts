import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleEventPublished } from '../../../apps/worker/src/notify/handle-published';
import type { ExpoPushClient } from '../../../apps/worker/src/notify/expo-push';
import * as match from '../../../apps/worker/src/notify/match';

const EVENT_ID = '11111111-1111-4111-8111-111111111201';
const USER_ID = '11111111-1111-4111-8111-111111111202';
const DEVICE_ID = '11111111-1111-4111-8111-111111111203';

function mockDb() {
  return {} as never;
}

describe('handleEventPublished', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(match, 'purgeExpiredNotifications').mockResolvedValue(0);
    vi.spyOn(match, 'markNotificationsPushed').mockResolvedValue();
    vi.spyOn(match, 'countUnreadNotifications').mockResolvedValue(1);
  });

  it('claims inbox and sends silent Expo push for matched users', async () => {
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
    vi.spyOn(match, 'findNearbyMatchedUsers').mockResolvedValue([{ userId: USER_ID }]);
    vi.spyOn(match, 'findPublisherSubscriberUsers').mockResolvedValue([]);
    const claim = vi.spyOn(match, 'claimNotification').mockResolvedValue('notif-1');
    vi.spyOn(match, 'loadPushDevicesForUsers').mockResolvedValue([
      {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        expoPushToken: 'ExponentPushToken[abc]',
        locale: 'sv',
      },
    ]);

    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo,
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    });

    expect(result).toEqual({ matched: 1, claimed: 1, sent: 1, skipped: 0 });
    expect(claim).toHaveBeenCalledOnce();
    expect(match.markNotificationsPushed).toHaveBeenCalledWith(
      expect.anything(),
      ['notif-1'],
      expect.any(Date),
    );
    expect(send).toHaveBeenCalledWith([
      expect.objectContaining({
        to: 'ExponentPushToken[abc]',
        _contentAvailable: true,
        badge: 1,
        data: expect.objectContaining({
          kind: 'inbox',
          notificationId: 'notif-1',
          eventId: EVENT_ID,
          reason: 'nearby',
          eventTitle: 'Konsert',
        }),
      }),
    ]);
    expect(send.mock.calls[0]![0]![0]).not.toHaveProperty('title');
    expect(send.mock.calls[0]![0]![0]).not.toHaveProperty('body');
  });

  it('still claims inbox during quiet hours and sends silent push', async () => {
    const send = vi.fn(async () => [{ status: 'ok' as const }]);
    vi.spyOn(match, 'loadPublishedEvent').mockResolvedValue({
      id: EVENT_ID,
      title: 'Konsert',
      status: 'published',
      publisherId: '11111111-1111-4111-8111-111111111204',
      hasLocation: true,
      categoryIds: ['cat'],
    });
    vi.spyOn(match, 'findNearbyMatchedUsers').mockResolvedValue([{ userId: USER_ID }]);
    vi.spyOn(match, 'findPublisherSubscriberUsers').mockResolvedValue([]);
    const claim = vi.spyOn(match, 'claimNotification').mockResolvedValue('notif-quiet');
    vi.spyOn(match, 'loadPushDevicesForUsers').mockResolvedValue([
      {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        expoPushToken: 'ExponentPushToken[abc]',
        locale: 'sv',
      },
    ]);

    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo: { send },
      now: () => new Date('2026-06-15T21:30:00.000Z'), // 23:30 CEST
    });

    expect(result).toEqual({ matched: 1, claimed: 1, sent: 1, skipped: 0 });
    expect(claim).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps inbox row when Expo returns no tickets', async () => {
    vi.spyOn(match, 'loadPublishedEvent').mockResolvedValue({
      id: EVENT_ID,
      title: 'Konsert',
      status: 'published',
      publisherId: '11111111-1111-4111-8111-111111111204',
      hasLocation: true,
      categoryIds: ['cat'],
    });
    vi.spyOn(match, 'findNearbyMatchedUsers').mockResolvedValue([{ userId: USER_ID }]);
    vi.spyOn(match, 'findPublisherSubscriberUsers').mockResolvedValue([]);
    vi.spyOn(match, 'claimNotification').mockResolvedValue('notif-1');
    vi.spyOn(match, 'loadPushDevicesForUsers').mockResolvedValue([
      {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        expoPushToken: 'ExponentPushToken[abc]',
        locale: 'sv',
      },
    ]);

    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo: { send: vi.fn(async () => []) },
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    });

    expect(result).toEqual({ matched: 1, claimed: 1, sent: 0, skipped: 0 });
    expect(match.markNotificationsPushed).not.toHaveBeenCalled();
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
    const findNearby = vi.spyOn(match, 'findNearbyMatchedUsers');
    vi.spyOn(match, 'findPublisherSubscriberUsers').mockResolvedValue([]);
    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo: { send: vi.fn() },
    });
    expect(result.matched).toBe(0);
    expect(findNearby).not.toHaveBeenCalled();
  });

  it('claims inbox even when the user has no push token', async () => {
    vi.spyOn(match, 'loadPublishedEvent').mockResolvedValue({
      id: EVENT_ID,
      title: 'Konsert',
      status: 'published',
      publisherId: '11111111-1111-4111-8111-111111111204',
      hasLocation: true,
      categoryIds: ['cat'],
    });
    vi.spyOn(match, 'findNearbyMatchedUsers').mockResolvedValue([{ userId: USER_ID }]);
    vi.spyOn(match, 'findPublisherSubscriberUsers').mockResolvedValue([]);
    const claim = vi.spyOn(match, 'claimNotification').mockResolvedValue('notif-1');
    vi.spyOn(match, 'loadPushDevicesForUsers').mockResolvedValue([]);
    const send = vi.fn();

    const result = await handleEventPublished(EVENT_ID, {
      db: mockDb(),
      expo: { send },
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    });

    expect(result).toEqual({ matched: 1, claimed: 1, sent: 0, skipped: 0 });
    expect(claim).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
});
