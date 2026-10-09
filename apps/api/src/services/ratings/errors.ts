import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { RatingError, type RatingErrorCode } from './types';

const MESSAGES: Record<RatingErrorCode, string> = {
  unauthorized: 'Unauthorized',
  forbidden: 'Not allowed for this event',
  not_found: 'Event not found',
  not_eligible: 'Rating is not open for this event',
  already_rated: 'Already rated',
  comment_not_allowed: 'Comments require a named public profile',
};

const STATUS: Record<RatingErrorCode, 400 | 401 | 403 | 404 | 409> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  not_eligible: 400,
  already_rated: 409,
  comment_not_allowed: 400,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ratingErrorResponse(c: Context, err: unknown): any {
  if (err instanceof RatingError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
