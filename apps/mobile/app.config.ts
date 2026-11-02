import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json' with { type: 'json' };

/**
 * Host for Universal Links / App Links.
 * Off unless EXPO_PUBLIC_APP_LINKS=1. The current App Store profile does not
 * include Associated Domains, so a store build that requests it fails to sign.
 */
function associatedWebHost(): string | null {
  if (process.env.EXPO_PUBLIC_APP_LINKS !== '1') return null;
  const raw = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:13100';
  try {
    const { hostname, host, protocol } = new URL(raw);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return null;
    if (protocol !== 'https:') return null;
    return host;
  } catch {
    return null;
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;
  const webHost = associatedWebHost();

  return {
    ...base,
    ...config,
    ios: {
      ...base.ios,
      ...(webHost ? { associatedDomains: [`applinks:${webHost}`] } : {}),
    },
    android: {
      ...base.android,
      ...(webHost
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                category: ['BROWSABLE', 'DEFAULT'],
                data: [
                  { scheme: 'https', host: webHost, pathPrefix: '/events' },
                  { scheme: 'https', host: webHost, pathPrefix: '/en/events' },
                  { scheme: 'https', host: webHost, pathPrefix: '/sv/events' },
                ],
              },
            ],
          }
        : {}),
    },
  };
};
