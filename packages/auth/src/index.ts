import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * Low-level auth primitives. Higher-level flows (identity creation, sessions, web pairing,
 * publisher/admin login) are built on these in this package; see docs/project-description.md.
 */

/** Random 256-bit device credential, returned once to the app and stored in secure storage. */
export function generateDeviceCredential(): string {
  return randomBytes(32).toString('base64url');
}

/** Opaque session token. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Single-use email verification / recovery token (returned once, stored hashed). */
export function generateEmailToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Credentials and tokens are stored hashed; only the client ever holds the raw value. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatchesHash(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Argon2id password hashes (see docs/project-description.md → Security). */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Short-lived app/API sessions traded from a device credential. */
export const APP_SESSION_TTL_SECONDS = 60 * 60;
/** Publisher web cookie sessions. */
export const PUBLISHER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Email verification link lifetime. */
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
/** Publisher member invite lifetime. */
export const PUBLISHER_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const PUBLISHER_SESSION_COOKIE = 'le_publisher_session';
export const APP_USER_SESSION_COOKIE = 'le_user_session';

/** Crockford-style alphabet without 0/O, 1/I/L, U to avoid misreads when typed by hand. */
const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_CODE_TTL_SECONDS = 5 * 60;

/** Code shown on the web (or a new phone) and entered/scanned in an already signed-in app. */
export function generatePairingCode(length = PAIRING_CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let code = '';
  for (const byte of bytes) code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  return code;
}

export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}
