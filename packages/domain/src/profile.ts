export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export type ProfileChoice =
  { choice: 'named'; displayName: string; isPublic?: boolean } | { choice: 'anonymous' };

export type ProfileChoiceResult =
  | { ok: true; displayName: string | null; isPublic: boolean }
  | { ok: false; reason: 'invalid_display_name' | 'name_required' };

/** Resolve first-check-in profile: named (optional public) or stay anonymous. */
export function resolveProfileChoice(input: ProfileChoice): ProfileChoiceResult {
  if (input.choice === 'anonymous') {
    return { ok: true, displayName: null, isPublic: false };
  }
  if (input.displayName == null) return { ok: false, reason: 'name_required' };
  const name = normalizeDisplayName(input.displayName);
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) {
    return { ok: false, reason: 'invalid_display_name' };
  }
  return {
    ok: true,
    displayName: name,
    isPublic: input.isPublic ?? true,
  };
}

/** Normalize recovery email for storage; empty clears. */
export function normalizeRecoveryEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}
