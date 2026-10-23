import { describe, expect, it } from 'vitest';

import { appVersion } from '../../../apps/mobile/src/lib/app-version';

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
