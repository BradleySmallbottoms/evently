import type {
  CheckIn,
  CheckInStatusResponse,
  CreateGeoCheckInRequest,
} from '@local-events/contracts';
import type { DomainEventPublisher } from '../domain-events/types';

export type CheckInErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'not_physical'
  | 'not_published'
  | 'outside_window'
  | 'poor_accuracy'
  | 'outside_geofence'
  | 'already_checked_in';

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
  getStatus: (
    sessionToken: string | undefined,
    eventId: string,
  ) => Promise<CheckInStatusResponse>;
  createGeo: (
    sessionToken: string | undefined,
    eventId: string,
    input: CreateGeoCheckInRequest,
  ) => Promise<CheckIn>;
};
