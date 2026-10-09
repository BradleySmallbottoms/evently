import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { CheckInError, type CheckInErrorCode } from './types';

const MESSAGES: Record<CheckInErrorCode, string> = {
  unauthorized: 'Unauthorized',
  not_found: 'Event not found',
  not_physical: 'Digital events use code check-in',
  not_published: 'Event is not open for check-in',
  outside_window: 'Check-in is not open yet or has closed',
  poor_accuracy: 'Location accuracy is too low',
  outside_geofence: 'You are too far from the venue',
  already_checked_in: 'Already checked in',
};

const STATUS: Record<CheckInErrorCode, 400 | 401 | 404 | 409> = {
  unauthorized: 401,
  not_found: 404,
  not_physical: 400,
  not_published: 400,
  outside_window: 400,
  poor_accuracy: 400,
  outside_geofence: 400,
  already_checked_in: 409,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkInErrorResponse(c: Context, err: unknown): any {
  if (err instanceof CheckInError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
