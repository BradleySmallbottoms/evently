import type { NextConfig } from 'next';
import path from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  transpilePackages: [
    '@local-events/api-client',
    '@local-events/contracts',
    '@local-events/domain',
    '@local-events/geo',
  ],
  cacheComponents: true,
  partialPrefetching: true,
};

export default withNextIntl(nextConfig);
