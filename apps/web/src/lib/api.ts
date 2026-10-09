import { ApiError, createApiClient, throwIfError } from '@local-events/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export const api = createApiClient({
  baseUrl: API_URL,
  credentials: 'include',
});

export { ApiError, API_URL, throwIfError };
