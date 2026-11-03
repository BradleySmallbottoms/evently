import { describe, expect, it } from 'vitest';

import { appVersion, otaUpdateId } from '../../../apps/mobile/src/lib/app-version';

describe('appVersion', () => {
  it('returns the embedded marketing version', () => {
    expect(appVersion('1.0.0')).toBe('1.0.0');
  });

  it('drops a blank version so the label can stay hidden', () => {
    expect(appVersion('  ')).toBeNull();
    expect(appVersion(null)).toBeNull();
    expect(appVersion(undefined)).toBeNull();
  });
});

describe('otaUpdateId', () => {
  const updateId = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

  it('shows the start of a downloaded update id', () => {
    expect(otaUpdateId({ enabled: true, embedded: false, updateId })).toBe('a1b2c3d4');
  });

  it('hides the id for the embedded bundle and for a dev build', () => {
    expect(otaUpdateId({ enabled: true, embedded: true, updateId })).toBeNull();
    expect(otaUpdateId({ enabled: false, embedded: false, updateId })).toBeNull();
    expect(otaUpdateId({ enabled: true, embedded: false, updateId: null })).toBeNull();
  });
});
