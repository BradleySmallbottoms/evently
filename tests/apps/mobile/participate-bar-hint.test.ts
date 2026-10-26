import { describe, expect, it } from 'vitest';

import {
  PARTICIPATE_BAR_HINT_SEEN_VALUE,
  isParticipateBarHintSeen,
} from '../../../apps/mobile/src/lib/participate-bar-hint';

describe('participate bar hint', () => {
  it('is unseen until the stored flag is set', () => {
    expect(isParticipateBarHintSeen(null)).toBe(false);
    expect(isParticipateBarHintSeen('')).toBe(false);
  });

  it('stays seen when the install flag is present', () => {
    expect(isParticipateBarHintSeen(PARTICIPATE_BAR_HINT_SEEN_VALUE)).toBe(true);
  });
});
