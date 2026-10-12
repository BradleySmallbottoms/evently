import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** Extra hostnames allowed to load `/_next/*` in `next dev` (cross-origin block otherwise). */
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  transpilePackages: ['@local-events/contracts', '@local-events/domain'],
  cacheComponents: true,
  partialPrefetching: true,
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default withNextIntl(nextConfig);
