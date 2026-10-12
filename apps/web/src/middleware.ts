import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip association files so Apple / Google can verify Universal / App Links.
  matcher: ['/', '/(sv|en)/:path*', '/((?!_next|_vercel|\\.well-known|.*\\..*).*)'],
};
