import { createApiClient, throwIfError } from '@local-events/api-client';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const api = createApiClient({ baseUrl: API_URL });

export { API_URL, throwIfError };
