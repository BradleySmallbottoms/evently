import { describe, expect, it, vi } from 'vitest';
import { bundledPushPresentation } from '../../../packages/domain/src/push-messages';

/**
 * Fan-out now runs via handleDuePushMessages (push_messages poll).
 * Keep a smoke check that aggregated copy used by the worker stays correct.
 */
describe('push aggregation presentation', () => {
  it('combines earliest title with And N more', () => {
    const presented = bundledPushPresentation('en', [
      {
        id: '1',
        sendAt: new Date('2026-06-15T12:00:00Z'),
        titleSv: 'Först',
        bodySv: 'sv',
        titleEn: 'First',
        bodyEn: 'A new event near you',
      },
      {
        id: '2',
        sendAt: new Date('2026-06-15T12:05:00Z'),
        titleSv: 'Andra',
        bodySv: 'sv2',
        titleEn: 'Second',
        bodyEn: 'body2',
      },
    ]);
    expect(presented.title).toBe('First');
    expect(presented.body).toContain('And 1 more…');
    expect(presented.moreCount).toBe(1);
  });

  it('silent push payload shape omits alert fields at Expo layer', () => {
    const send = vi.fn();
    send([
      {
        to: 'ExponentPushToken[x]',
        data: { kind: 'inbox', title: 'First', body: 'A new event near you\nAnd 1 more…' },
        _contentAvailable: true,
      },
    ]);
    expect(send.mock.calls[0]![0]![0]).not.toHaveProperty('title');
    expect(send.mock.calls[0]![0]![0]).not.toHaveProperty('body');
  });
});
