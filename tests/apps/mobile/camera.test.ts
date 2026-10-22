import { describe, expect, it } from 'vitest';

import { canLaunchCamera, tipImageSources } from '../../../apps/mobile/src/lib/camera';

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

  it('uses the photo library in a browser', () => {
    expect(canLaunchCamera('web', true)).toBe(false);
    expect(canLaunchCamera('web', false)).toBe(false);
  });
});

describe('tipImageSources', () => {
  it('offers the photo library when the iOS Simulator cannot open the camera', () => {
    expect(tipImageSources('ios', false)).toEqual(['library']);
  });

  it('offers the camera and the photo library on a real iPhone', () => {
    expect(tipImageSources('ios', true)).toEqual(['camera', 'library']);
  });

  it('offers both on Android', () => {
    expect(tipImageSources('android', true)).toEqual(['camera', 'library']);
  });

  it('offers only the photo library in a browser', () => {
    expect(tipImageSources('web', true)).toEqual(['library']);
  });
});
