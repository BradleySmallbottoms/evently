import type {
  CheckIn,
  CheckInHistoryResponse,
  CheckInStatusResponse,
  CreateCodeCheckInRequest,
  CreateGeoCheckInRequest,
  DigitalCodeSessionResponse,
} from '@local-events/contracts';
import type { DomainEventPublisher } from '../domain-events/types';

export type CheckInErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'not_physical'
  | 'not_published'
  | 'outside_window'
  | 'poor_accuracy'
  | 'outside_geofence'
  | 'already_checked_in'
  | 'invalid_code'
  | 'not_revealed'
  | 'check_in_disabled';

export class CheckInError extends Error {
  constructor(readonly code: CheckInErrorCode) {
    super(code);
    this.name = 'CheckInError';
  }
}

export type CheckInEnv = {
  now?: () => Date;
  domainEvents?: DomainEventPublisher;
};

export type CheckInServices = {
  /** Newest check-ins for the signed-in user, including events that have ended. */
  listMine: (sessionToken: string | undefined) => Promise<CheckInHistoryResponse>;
  getStatus: (sessionToken: string | undefined, eventId: string) => Promise<CheckInStatusResponse>;
  createGeo: (
    sessionToken: string | undefined,
    eventId: string,
    input: CreateGeoCheckInRequest,
  ) => Promise<CheckIn>;
  createCode: (
    sessionToken: string | undefined,
    eventId: string,
    input: CreateCodeCheckInRequest,
  ) => Promise<CheckIn>;
  /** Publisher: ensure secret exists and set revealed_at. */
  startDigitalCode: (
    publisherSessionToken: string | undefined,
    eventId: string,
  ) => Promise<DigitalCodeSessionResponse>;
  /** Publisher: current rotating code (null until started). */
  getDigitalCodeSession: (
    publisherSessionToken: string | undefined,
    eventId: string,
  ) => Promise<DigitalCodeSessionResponse>;
};
