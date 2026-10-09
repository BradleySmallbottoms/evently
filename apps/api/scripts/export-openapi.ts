/**
 * Writes the public API OpenAPI document to packages/api-client/openapi.json.
 * Run via `pnpm api-client:generate` — does not need a live server.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../packages/api-client/openapi.json');

const res = await createApp().request('/v1/openapi.json');
if (!res.ok) {
  console.error(`Failed to export OpenAPI: HTTP ${res.status}`);
  process.exit(1);
}
const doc = await res.json();
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote ${out}`);
