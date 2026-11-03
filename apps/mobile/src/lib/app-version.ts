/** Marketing version from the embedded app config, or null when the build has none. */
export function appVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Short id of the update that is actually running.
 * The embedded bundle and a dev build have no OTA id to show.
 * The first eight characters match the start of the update id in the EAS dashboard.
 */
export function otaUpdateId(input: {
  enabled: boolean;
  embedded: boolean;
  updateId: string | null | undefined;
}): string | null {
  if (!input.enabled || input.embedded) return null;
  const id = input.updateId?.trim() ?? '';
  if (id.length < 8) return null;
  return id.slice(0, 8);
}
