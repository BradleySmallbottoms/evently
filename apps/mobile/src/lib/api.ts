import { createApiClient, throwIfError } from '@local-events/api-client';

/** Base URL including the version prefix (OpenAPI paths are unversioned). */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1';

export const api = createApiClient({ baseUrl: API_URL });

export { API_URL, throwIfError };
