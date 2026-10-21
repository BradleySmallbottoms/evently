import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';

export type TipErrorCode =
  | 'not_found'
  | 'daily_limit'
  | 'open_limit'
  | 'unsupported_type'
  | 'too_large'
  | 'too_many'
  | 'invalid_state'
  | 'source_missing';

export class TipError extends Error {
  constructor(readonly code: TipErrorCode) {
    super(code);
  }
}

const MESSAGES: Record<TipErrorCode, string> = {
  not_found: 'Tip not found',
  daily_limit: 'Daily tip limit reached',
  open_limit: 'Too many unfinished tips',
  unsupported_type: 'Unsupported image type',
  too_large: 'Image is too large',
  too_many: 'Too many images',
  invalid_state: 'Tip cannot take that step',
  source_missing: 'User tip source is not configured',
};

const STATUS: Record<TipErrorCode, 400 | 404 | 409 | 500> = {
  not_found: 404,
  daily_limit: 409,
  open_limit: 409,
  unsupported_type: 400,
  too_large: 400,
  too_many: 409,
  invalid_state: 409,
  source_missing: 500,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tipErrorResponse(c: Context, err: unknown): any {
  if (err instanceof TipError) {
    const body: ErrorResponse = { error: { code: err.code, message: MESSAGES[err.code] } };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
