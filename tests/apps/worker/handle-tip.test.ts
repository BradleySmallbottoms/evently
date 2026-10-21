import { describe, expect, it } from 'vitest';
import { tipPushMessages } from '../../../apps/worker/src/notify/handle-tip';

describe('tip push messages', () => {
  it('uses a visible alert and only says the event was added when it is published', () => {
    const published = tipPushMessages({
      tokens: ['ExponentPushToken[abc]'],
      locale: 'sv',
      status: 'published',
      title: 'Sommarkonsert',
      place: 'Stadsparken',
      tipId: '11111111-1111-4111-8111-111111111111',
      eventId: '22222222-2222-4222-8222-222222222222',
    });
    expect(published[0]?.title).toBe('Ditt event är klart!');
    expect(published[0]?.body).toContain('Sommarkonsert');
    expect(published[0]?.data).toMatchObject({ kind: 'tip_scan', status: 'published' });

    const review = tipPushMessages({
      tokens: ['ExponentPushToken[abc]'],
      locale: 'sv',
      status: 'in_review',
      title: 'Sommarkonsert',
      place: null,
      tipId: '11111111-1111-4111-8111-111111111111',
      eventId: '22222222-2222-4222-8222-222222222222',
    });
    expect(review[0]?.body).not.toContain('lagt till');
  });
});
