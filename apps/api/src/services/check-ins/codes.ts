import { createHmac, randomBytes } from 'node:crypto';
import {
  acceptedDigitalCodeSlots,
  DIGITAL_CODE_ALPHABET,
  DIGITAL_CODE_LENGTH,
} from '@local-events/domain';

export function generateDigitalCodeSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function deriveDigitalCode(secret: string, slot: number): string {
  const digest = createHmac('sha256', secret).update(`le-code:${slot}`).digest();
  let code = '';
  for (let i = 0; i < DIGITAL_CODE_LENGTH; i += 1) {
    code += DIGITAL_CODE_ALPHABET[digest[i]! % DIGITAL_CODE_ALPHABET.length]!;
  }
  return code;
}

export function validCodesForNow(secret: string, now: Date): string[] {
  return acceptedDigitalCodeSlots(now).map((slot) => deriveDigitalCode(secret, slot));
}
