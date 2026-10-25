import { createHash, timingSafeEqual } from 'node:crypto';

/** Credentials and tokens are stored hashed; only the client ever holds the raw value. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatchesHash(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
