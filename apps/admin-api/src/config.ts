import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type PackageJson = {
  apiVersion?: string | number;
};

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
) as PackageJson;

/** Major API version from apps/admin-api/package.json `apiVersion` (default 1). */
export const API_VERSION = String(pkg.apiVersion ?? 1);

/** URL prefix for versioned routes, e.g. `/v1`. Health stays outside this prefix. */
export const API_PREFIX = `/v${API_VERSION}`;
