import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { createApiClient, throwIfError } from '@local-events/api-client';

/** Base URL including the version prefix (OpenAPI paths are unversioned). */
const configured = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:3000/v1';

/**
 * The iOS Simulator shares the Mac, but `localhost` resolves to IPv6 (::1) and
 * the request fails. `127.0.0.1` stays on IPv4. A physical phone still needs the
 * Mac's LAN address in EXPO_PUBLIC_API_URL.
 */
function resolveApiUrl(url: string): string {
  if (Platform.OS === 'ios' && !Device.isDevice) {
    return url.replace('://localhost', '://127.0.0.1');
  }
  return url;
}

const API_URL = resolveApiUrl(configured);

export const api = createApiClient({ baseUrl: API_URL });

export { API_URL, throwIfError };
