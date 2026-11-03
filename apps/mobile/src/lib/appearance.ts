export const APPEARANCE_STORAGE_KEY = 'le.appearance';

export type AppearancePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export function parseAppearance(value: string | null | undefined): AppearancePreference {
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return 'system';
}

/** `system` follows the device. A missing device scheme stays light. */
export function resolveAppearance(
  preference: AppearancePreference,
  system: ColorScheme | null | undefined,
): ColorScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return system === 'dark' ? 'dark' : 'light';
}
