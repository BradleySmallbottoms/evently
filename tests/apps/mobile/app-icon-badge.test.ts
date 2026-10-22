import { describe, expect, it } from 'vitest';

import {
  badgeApplyKey,
  badgeCountFromNotification,
  badgeUpdateFromTaskPayload,
  isLocalInboxPush,
  resolveAppIconBadge,
} from '../../../apps/mobile/src/lib/app-icon-badge';

const inbox = {
  kind: 'inbox',
  notificationId: 'n1',
  eventId: 'e1',
  badge: '4',
};

describe('badgeUpdateFromTaskPayload', () => {
  it('reads the iOS badge and the inbox id', () => {
    expect(
      badgeUpdateFromTaskPayload({
        aps: { badge: 4, 'content-available': 1 },
        data: { body: inbox },
      }),
    ).toEqual({ count: 4, key: 'inbox:n1' });
  });

  it('reads a string badge next to the Android data payload', () => {
    expect(
      badgeUpdateFromTaskPayload({
        data: { badge: '3', dataString: JSON.stringify(inbox) },
      }),
    ).toEqual({ count: 3, key: 'inbox:n1' });
  });

  it('adds one when an inbox push has no count', () => {
    expect(
      badgeUpdateFromTaskPayload({
        data: { kind: 'inbox', notificationId: 'n2' },
      }),
    ).toEqual({ count: null, key: 'inbox:n2' });
  });

  it('reads a tip id', () => {
    expect(
      badgeUpdateFromTaskPayload({
        data: { kind: 'tip_scan', tipId: 't1', badge: '1' },
      }),
    ).toEqual({ count: 1, key: 'tip_scan:t1' });
  });

  it('ignores taps and the local banner posted for a silent push', () => {
    expect(
      badgeUpdateFromTaskPayload({
        actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
        notification: { request: { content: { data: inbox } } },
      }),
    ).toBeNull();
    expect(badgeUpdateFromTaskPayload({ data: { kind: 'local_inbox', badge: '2' } })).toBeNull();
    expect(badgeUpdateFromTaskPayload({ data: { experienceId: '@app' } })).toBeNull();
  });
});

describe('badge count on a received notification', () => {
  it('prefers the notification content badge, then data', () => {
    expect(badgeCountFromNotification({ contentBadge: 6, data: { badge: '1' } })).toBe(6);
    expect(badgeCountFromNotification({ data: { badge: '2' } })).toBe(2);
    expect(badgeCountFromNotification({ data: { kind: 'inbox' } })).toBeNull();
    expect(isLocalInboxPush({ kind: 'local_inbox' })).toBe(true);
    expect(badgeApplyKey({ kind: 'inbox', notificationId: 'n1' }, 'fallback')).toBe('inbox:n1');
    expect(badgeApplyKey({ kind: 'tip_scan' }, 'req-1')).toBe('req-1');
    expect(badgeApplyKey({ kind: 'local_inbox', notificationId: 'n1' })).toBeNull();
  });
});

describe('resolveAppIconBadge', () => {
  it('uses the push count, and adds one when the push has none', () => {
    expect(
      resolveAppIconBadge({
        appIsActive: false,
        allowWhileActive: false,
        current: 2,
        incoming: 5,
        duplicate: false,
      }),
    ).toBe(5);
    expect(
      resolveAppIconBadge({
        appIsActive: true,
        allowWhileActive: true,
        current: 2,
        incoming: null,
        duplicate: false,
      }),
    ).toBe(3);
  });

  it('leaves the icon alone for a duplicate or a headless delivery while the app is open', () => {
    expect(
      resolveAppIconBadge({
        appIsActive: true,
        allowWhileActive: false,
        current: 2,
        incoming: 5,
        duplicate: false,
      }),
    ).toBeNull();
    expect(
      resolveAppIconBadge({
        appIsActive: false,
        allowWhileActive: false,
        current: 2,
        incoming: 5,
        duplicate: true,
      }),
    ).toBeNull();
  });
});
