'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/** Initializes browser Sentry when NEXT_PUBLIC_SENTRY_DSN is set. */
export function SentryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
  }, []);

  return children;
}
