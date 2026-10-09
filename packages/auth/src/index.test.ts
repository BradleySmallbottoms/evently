import { describe, expect, it } from 'vitest';
import {
  generateDeviceCredential,
  generateEmailToken,
  generatePairingCode,
  hashPassword,
  hashToken,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  tokenMatchesHash,
  verifyPassword,
} from './index';

describe('device credentials', () => {
  it('are unique and verify against their hash', () => {
    const a = generateDeviceCredential();
    const b = generateDeviceCredential();
    expect(a).not.toBe(b);
    expect(tokenMatchesHash(a, hashToken(a))).toBe(true);
    expect(tokenMatchesHash(b, hashToken(a))).toBe(false);
  });
});

describe('pairing codes', () => {
  it('have the expected length and no ambiguous characters', () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    expect(code).not.toMatch(/[01ILOU]/);
  });
  it('normalize user input', () => {
    expect(normalizePairingCode(' ab-cd 23ef ')).toBe('ABCD23EF');
  });
});

describe('passwords', () => {
  it('hash and verify with argon2id', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).not.toContain('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('email tokens', () => {
  it('are unique opaque values', () => {
    expect(generateEmailToken()).not.toBe(generateEmailToken());
  });
});
