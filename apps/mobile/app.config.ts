import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json' with { type: 'json' };

/** Host for Universal Links / App Links; null for localhost (HTTPS association required). */
function associatedWebHost(): string | null {
  const raw = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3100';
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
