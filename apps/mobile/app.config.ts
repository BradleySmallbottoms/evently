import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withInfoPlist, type ConfigPlugin } from 'expo/config-plugins';

import appJson from './app.json' with { type: 'json' };

/**
 * Native Facebook share dialog. Omitted until both values exist, because the
 * plugin refuses to run without them. Set them in apps/mobile/.env, then
 * rebuild the dev client. An OTA update cannot add the SDK.
 */
const withMessengerQueryScheme: ConfigPlugin = (config) =>
  withInfoPlist(config, (config) => {
    const existing = config.modResults.LSApplicationQueriesSchemes;
    const schemes = Array.isArray(existing)
      ? existing.filter((scheme): scheme is string => typeof scheme === 'string')
      : [];
    if (!schemes.includes('fb-messenger-share-api')) {
      config.modResults.LSApplicationQueriesSchemes = [...schemes, 'fb-messenger-share-api'];
    }
    return config;
  });

function facebookSharePlugin(): (NonNullable<ExpoConfig['plugins']>[number] | ConfigPlugin)[] {
  const appID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID?.trim() ?? '';
  const clientToken = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN?.trim() ?? '';
  if (!/^\d+$/.test(appID) || clientToken.length === 0) return [];
  return [
    [
      'react-native-fbsdk-next',
      {
        appID,
        clientToken,
        displayName: 'Evently',
        scheme: `fb${appID}`,
        advertiserIDCollectionEnabled: false,
        autoLogAppEventsEnabled: false,
        isAutoInitEnabled: false,
        iosUserTrackingPermission: false,
      },
    ],
    // The SDK asks iOS if Messenger is installed through this scheme.
    // The Facebook plugin writes the older fb-messenger-api name only.
    withMessengerQueryScheme,
  ];
}

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
    plugins: [...(base.plugins ?? []), ...facebookSharePlugin()] as ExpoConfig['plugins'],
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
