import { describe, expect, it } from 'vitest';
import {
  acceptedDigitalCodeSlots,
  digitalCheckInQrPayload,
  digitalCodeSlot,
  normalizeDigitalCode,
  parseDigitalCheckInQr,
  validateCodeCheckIn,
} from '../../../packages/domain/src/digital-codes';

describe('digital codes', () => {
  const event = {
    startsAt: new Date('2026-06-15T10:00:00.000Z'),
    endsAt: new Date('2026-06-15T12:00:00.000Z'),
  };
  const now = new Date('2026-06-15T10:30:00.000Z');

  it('accepts current and previous slot codes', () => {
    const result = validateCodeCheckIn({
      event,
      revealed: true,
      validCodes: ['ABCDEF', 'GHIJKL'],
      code: 'abcdef',
      alreadyCheckedIn: false,
      now,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects when not revealed or outside window', () => {
    expect(
      validateCodeCheckIn({
        event,
        revealed: false,
        validCodes: ['ABCDEF'],
        code: 'ABCDEF',
        alreadyCheckedIn: false,
        now,
      }).ok,
    ).toBe(false);
    expect(
      validateCodeCheckIn({
        event,
        revealed: true,
        validCodes: ['ABCDEF'],
        code: 'ABCDEF',
        alreadyCheckedIn: false,
        now: new Date('2026-06-15T08:00:00.000Z'),
      }),
    ).toEqual({ ok: false, reason: 'outside_window' });
  });

  it('parses QR payloads', () => {
    const id = '11111111-1111-4111-8111-111111111401';
    const payload = digitalCheckInQrPayload(id, 'AbC-123');
    expect(payload).toContain(id);
    expect(parseDigitalCheckInQr(payload)).toEqual({
      eventId: id,
      code: 'ABC123',
    });
    expect(normalizeDigitalCode(' ab-cd ')).toBe('ABCD');
  });

  it('computes slots', () => {
    const slot = digitalCodeSlot(now);
    expect(acceptedDigitalCodeSlots(now)).toEqual([slot, slot - 1]);
  });
});
