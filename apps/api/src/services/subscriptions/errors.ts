import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { SubscriptionError, type SubscriptionErrorCode } from './types';

const MESSAGES: Record<SubscriptionErrorCode, string> = {
  unauthorized: 'Unauthorized',
  not_found: 'Subscription not found',
  invalid_target: 'Invalid subscription target',
};

const STATUS: Record<SubscriptionErrorCode, 400 | 401 | 404> = {
  unauthorized: 401,
  not_found: 404,
  invalid_target: 400,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function subscriptionErrorResponse(c: Context, err: unknown): any {
  if (err instanceof SubscriptionError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
