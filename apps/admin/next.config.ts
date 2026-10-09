import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@local-events/contracts', '@local-events/domain'],
  cacheComponents: true,
  partialPrefetching: true,
};

export default withNextIntl(nextConfig);
