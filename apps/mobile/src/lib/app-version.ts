/** Marketing version from the embedded app config, or null when the build has none. */
export function appVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
