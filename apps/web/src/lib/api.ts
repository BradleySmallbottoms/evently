import { ApiError, createApiClient, throwIfError } from '@local-events/api-client';

/** Base URL including the version prefix (OpenAPI paths are unversioned). */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1';

export const api = createApiClient({
  baseUrl: API_URL,
  credentials: 'include',
});

export { ApiError, API_URL, throwIfError };
