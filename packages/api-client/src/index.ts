import createClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './schema';

export type { paths };
export type { components, operations } from './schema';

export type ApiClient = ReturnType<typeof createApiClient>;

export type CreateApiClientOptions = Pick<
  ClientOptions,
  'baseUrl' | 'credentials' | 'headers' | 'fetch' | 'querySerializer' | 'bodySerializer'
>;

/** Typed openapi-fetch client for the public API. */
export function createApiClient(options: CreateApiClientOptions) {
  return createClient<paths>(options);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ErrorBody = { error?: { code?: string; message?: string } };

/**
 * Throws {@link ApiError} when the response is not OK or openapi-fetch returned `error`.
 * Use for routes that always return a JSON body on success (not 204).
 */
export function throwIfError<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.response.ok && result.data !== undefined) return result.data;
  if (result.response.status === 204) return undefined as T;

  const body = (result.error ?? undefined) as ErrorBody | undefined;
  throw new ApiError(
    body?.error?.message ?? `API ${result.response.status}`,
    result.response.status,
    body?.error?.code,
  );
}
