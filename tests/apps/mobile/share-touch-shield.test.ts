import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  armShareTouchShield,
  releaseShareTouchShield,
  resetShareTouchShield,
  SHARE_TOUCH_SHIELD_RELEASE_MS,
  shareTouchShieldActive,
} from '../../../apps/mobile/src/lib/share-touch-shield';

afterEach(() => {
  resetShareTouchShield();
  vi.useRealTimers();
});

describe('share touch shield', () => {
  it('covers the screen while the share sheet is open', () => {
    expect(shareTouchShieldActive()).toBe(false);
    armShareTouchShield();
    expect(shareTouchShieldActive()).toBe(true);
  });

  it('stays up briefly after the sheet closes so the dismiss tap is swallowed', () => {
    vi.useFakeTimers();
    armShareTouchShield();
    releaseShareTouchShield();
    expect(shareTouchShieldActive()).toBe(true);
    vi.advanceTimersByTime(SHARE_TOUCH_SHIELD_RELEASE_MS - 1);
    expect(shareTouchShieldActive()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(shareTouchShieldActive()).toBe(false);
  });

  it('stays up when another share starts during the release delay', () => {
    vi.useFakeTimers();
    armShareTouchShield();
    releaseShareTouchShield();
    armShareTouchShield();
    vi.advanceTimersByTime(SHARE_TOUCH_SHIELD_RELEASE_MS);
    expect(shareTouchShieldActive()).toBe(true);
    releaseShareTouchShield();
    vi.advanceTimersByTime(SHARE_TOUCH_SHIELD_RELEASE_MS);
    expect(shareTouchShieldActive()).toBe(false);
  });
});
