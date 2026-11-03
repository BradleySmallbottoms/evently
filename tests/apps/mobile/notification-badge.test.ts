import { describe, expect, it } from 'vitest';

import { unreadSince } from '../../../apps/mobile/src/lib/unread-since';

const older = '2026-11-03T10:00:00.000Z';
const newer = '2026-11-03T11:00:00.000Z';

describe('unreadSince', () => {
  it('counts every unread row when the list has never been opened', () => {
    expect(
      unreadSince(
        [
          { createdAt: newer, readAt: null },
          { createdAt: older, readAt: newer },
        ],
        null,
      ),
    ).toBe(1);
  });

  it('counts only unread rows that arrived after the list was opened', () => {
    expect(
      unreadSince(
        [
          { createdAt: newer, readAt: null },
          { createdAt: older, readAt: null },
        ],
        older,
      ),
    ).toBe(1);
  });
});
