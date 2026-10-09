import * as Sentry from '@sentry/react-native';

let initialized = false;

/** No-op when EXPO_PUBLIC_SENTRY_DSN is unset. */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
    tracesSampleRate: 0.1,
  });
  initialized = true;
}

export { Sentry };
