import { describe, expect, it } from 'vitest';

import { inboxExpoMessage } from '../../../apps/worker/src/notify/inbox-push';

const data = { kind: 'inbox', title: 'Jazz', body: 'Ett nytt evenemang nära dig' };

describe('inboxExpoMessage', () => {
  it('sends a visible alert so the phone shows a banner', () => {
    expect(
      inboxExpoMessage({
        to: 'ExponentPushToken[x]',
        title: 'Jazz',
        body: 'Ett nytt evenemang nära dig',
        data,
        badge: 2,
        alert: true,
      }),
    ).toEqual({
      to: 'ExponentPushToken[x]',
      title: 'Jazz',
      body: 'Ett nytt evenemang nära dig',
      sound: 'default',
      priority: 'high',
      badge: 2,
      channelId: 'inbox',
      data,
    });
  });

  it('sends badge and data only during quiet hours', () => {
    const message = inboxExpoMessage({
      to: 'ExponentPushToken[x]',
      title: 'Jazz',
      body: 'Ett nytt evenemang nära dig',
      data,
      badge: 2,
      alert: false,
    });
    expect(message).not.toHaveProperty('title');
    expect(message).toMatchObject({
      badge: 2,
      _contentAvailable: true,
      priority: 'normal',
    });
  });
});
