import * as Sentry from '@sentry/node';

/** No-op when SENTRY_DSN is unset so local/CI work without a project. */
export function initSentry(service: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
  Sentry.setTag('service', service);
}

export { Sentry };
