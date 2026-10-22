import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { AuthError } from '../auth/types';
import { NotificationError } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function notificationErrorResponse(c: Context, err: unknown): any {
  if (
    err instanceof AuthError ||
    (err instanceof NotificationError && err.code === 'unauthorized')
  ) {
    const body: ErrorResponse = {
      error: { code: 'unauthorized', message: 'Unauthorized' },
    };
    return c.json(body, 401);
  }
  if (err instanceof NotificationError && err.code === 'not_found') {
    const body: ErrorResponse = {
      error: { code: 'not_found', message: 'Notification not found' },
    };
    return c.json(body, 404);
  }
  throw err;
}
