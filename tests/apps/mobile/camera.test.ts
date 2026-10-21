import { describe, expect, it } from 'vitest';

import { canLaunchCamera } from '../../../apps/mobile/src/lib/camera';

describe('canLaunchCamera', () => {
  it('skips the camera on the iOS Simulator', () => {
    expect(canLaunchCamera('ios', false)).toBe(false);
  });

  it('opens the camera on a real iPhone', () => {
    expect(canLaunchCamera('ios', true)).toBe(true);
  });

  it('opens the camera on Android, including an emulator', () => {
    expect(canLaunchCamera('android', false)).toBe(true);
    expect(canLaunchCamera('android', true)).toBe(true);
  });
});
