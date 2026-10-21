import { describe, expect, it } from 'vitest';

import {
  inboxPushFieldsFromTaskPayload,
  readInboxPushFields,
} from '../../../apps/mobile/src/lib/inbox-push-payload';

const inbox = {
  kind: 'inbox',
  notificationId: 'n1',
  eventId: 'e1',
  reason: 'nearby',
  eventTitle: 'Gig',
  title: 'Gig',
  body: 'A new event near you',
};

describe('inboxPushFieldsFromTaskPayload', () => {
  it('reads inbox fields from dataString', () => {
    expect(
      inboxPushFieldsFromTaskPayload({
        notification: null,
        data: { dataString: JSON.stringify(inbox), experienceId: '@candybananaab/local-events' },
      }),
    ).toEqual(inbox);
  });

  it('reads a JSON body string', () => {
    expect(
      inboxPushFieldsFromTaskPayload({
        data: { body: JSON.stringify(inbox) },
      }),
    ).toEqual(inbox);
  });

  it('reads a nested body object', () => {
    expect(inboxPushFieldsFromTaskPayload({ data: { body: inbox } })).toEqual(inbox);
  });

  it('reads fields flattened onto data', () => {
    expect(inboxPushFieldsFromTaskPayload({ data: inbox })).toEqual(inbox);
  });

  it('ignores notification taps and non-inbox payloads', () => {
    expect(
      inboxPushFieldsFromTaskPayload({
        actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
        notification: { request: { content: { data: inbox } } },
      }),
    ).toBeNull();
    expect(
      inboxPushFieldsFromTaskPayload({ data: { kind: 'reminder', eventId: 'e1' } }),
    ).toBeNull();
    expect(readInboxPushFields({ kind: 'local_inbox', title: 'Gig' })).toBeNull();
  });
});
