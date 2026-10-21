import { isCheckInOpen, type CheckInEvent } from './check-in';

/** TOTP-style slot length for rotating venue / digital check-in codes. */
export const DIGITAL_CODE_SLOT_SECONDS = 60;
export const DIGITAL_CODE_LENGTH = 6;
/** Crockford-like alphabet without ambiguous 0/O/1/I. */
export const DIGITAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function digitalCodeSlot(now: Date): number {
  return Math.floor(now.getTime() / 1000 / DIGITAL_CODE_SLOT_SECONDS);
}

/** Slots the server accepts: current and previous (clock skew / late scan). */
export function acceptedDigitalCodeSlots(now: Date): [number, number] {
  const slot = digitalCodeSlot(now);
  return [slot, slot - 1];
}

export function normalizeDigitalCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export type CodeCheckInResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'outside_window' | 'invalid_code' | 'already_checked_in' | 'not_revealed';
    };

export interface CodeCheckInInput {
  event: CheckInEvent;
  /** Publisher has pressed Start (revealed_at set). */
  revealed: boolean;
  /** Precomputed codes for accepted slots (server derives via HMAC). */
  validCodes: readonly string[];
  code: string;
  alreadyCheckedIn: boolean;
  now: Date;
}

/** Venue QR / digital check-in against TOTP-style codes for the current window. */
export function validateCodeCheckIn(input: CodeCheckInInput): CodeCheckInResult {
  if (input.alreadyCheckedIn) return { ok: false, reason: 'already_checked_in' };
  if (!input.revealed) return { ok: false, reason: 'not_revealed' };
  if (!isCheckInOpen(input.event, input.now)) return { ok: false, reason: 'outside_window' };
  const normalized = normalizeDigitalCode(input.code);
  if (normalized.length !== DIGITAL_CODE_LENGTH) return { ok: false, reason: 'invalid_code' };
  const ok = input.validCodes.some((c) => normalizeDigitalCode(c) === normalized);
  return ok ? { ok: true } : { ok: false, reason: 'invalid_code' };
}

/** Payload encoded in venue / live QR: localevents://check-in/{eventId}?c={code} */
export function digitalCheckInQrPayload(eventId: string, code: string): string {
  return `localevents://check-in/${eventId}?c=${normalizeDigitalCode(code)}`;
}

export function parseDigitalCheckInQr(payload: string): { eventId: string; code: string } | null {
  try {
    const url = new URL(payload);
    if (url.protocol !== 'localevents:') return null;
    // localevents://check-in/{eventId}?c=CODE → host "check-in", path "/{eventId}"
    if (url.hostname !== 'check-in') return null;
    const eventId = url.pathname.replace(/^\//, '').split('/')[0];
    const code = url.searchParams.get('c');
    if (!eventId || !code) return null;
    return { eventId, code: normalizeDigitalCode(code) };
  } catch {
    return null;
  }
}
