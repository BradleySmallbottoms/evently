/** Minimum publisher password length (enforced in contracts and domain). */
export const MIN_PASSWORD_LENGTH = 10;

export function canPublisherLogin(account: {
  emailVerifiedAt: Date | null;
}): { ok: true } | { ok: false; reason: 'email_unverified' } {
  if (!account.emailVerifiedAt) return { ok: false, reason: 'email_unverified' };
  return { ok: true };
}

/** URL-safe slug from a publisher display name. */
export function slugifyPublisherName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'publisher';
}

export function isPasswordStrongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Device linking: a new phone shows a code; an existing phone confirms.
 * The confirming user must differ from the pending (new) user.
 */
export function canConfirmDeviceLink(input: {
  pendingUserId: string;
  confirmingUserId: string;
}): { ok: true } | { ok: false; reason: 'same_user' } {
  if (input.pendingUserId === input.confirmingUserId) {
    return { ok: false, reason: 'same_user' };
  }
  return { ok: true };
}
