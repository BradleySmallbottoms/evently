import { isWithinRadius, type GeoPoint } from '@local-events/geo';

export const CHECK_IN_OPENS_BEFORE_MINUTES = 30;
/** Locations reported with worse accuracy than this are rejected outright. */
export const MAX_LOCATION_ACCURACY_M = 100;

export interface CheckInEvent {
  startsAt: Date;
  endsAt: Date;
  /** Check-in opens this many minutes before start (per-event override). */
  opensBeforeMinutes?: number;
}

export function checkInWindow(event: CheckInEvent): { opensAt: Date; closesAt: Date } {
  const before = event.opensBeforeMinutes ?? CHECK_IN_OPENS_BEFORE_MINUTES;
  return {
    opensAt: new Date(event.startsAt.getTime() - before * 60_000),
    closesAt: event.endsAt,
  };
}

export function isCheckInOpen(event: CheckInEvent, now: Date): boolean {
  const { opensAt, closesAt } = checkInWindow(event);
  return now >= opensAt && now <= closesAt;
}

export type GeoCheckInResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'outside_window' | 'poor_accuracy' | 'outside_geofence' | 'already_checked_in';
    };

export interface GeoCheckInInput {
  event: CheckInEvent & { geofenceCenter: GeoPoint; geofenceRadiusM: number };
  location: GeoPoint;
  accuracyM: number;
  alreadyCheckedIn: boolean;
  now: Date;
}

/** Physical check-in rule. Rate limiting and device flags are handled by the caller. */
export function validateGeoCheckIn(input: GeoCheckInInput): GeoCheckInResult {
  if (input.alreadyCheckedIn) return { ok: false, reason: 'already_checked_in' };
  if (!isCheckInOpen(input.event, input.now)) return { ok: false, reason: 'outside_window' };
  if (input.accuracyM > MAX_LOCATION_ACCURACY_M) return { ok: false, reason: 'poor_accuracy' };
  const inside = isWithinRadius(
    input.location,
    input.event.geofenceCenter,
    input.event.geofenceRadiusM,
    input.accuracyM,
  );
  return inside ? { ok: true } : { ok: false, reason: 'outside_geofence' };
}
