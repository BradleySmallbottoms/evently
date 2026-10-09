/**
 * Writes the public API OpenAPI document to packages/api-client/openapi.json.
 * Run via `pnpm api-client:generate` — does not need a live server.
 *
 * Paths in the document are relative to `API_PREFIX` (e.g. `/identities`). Clients should set
 * `baseUrl` to `https://host/v1` (see package.json `apiVersion`).
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app';
import { API_PREFIX } from '../src/config';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../packages/api-client/openapi.json');

const res = await createApp().request(`${API_PREFIX}/openapi.json`);
if (!res.ok) {
  console.error(`Failed to export OpenAPI: HTTP ${res.status}`);
  process.exit(1);
}
const doc = await res.json();
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote ${out} (paths relative to ${API_PREFIX})`);
