import { createServer } from 'node:http';
import { imageDeliverySize, safeAssetKey } from '@local-events/domain';
import { IMAGE_SOURCE_MAX_BYTES, renderWebp } from './resize';

const origin = (process.env.ASSET_ORIGIN ?? 'http://garage:3902').replace(/\/$/, '');
const assetHost = process.env.ASSET_HOST ?? 'local-events-assets.localhost';
const port = Number(process.env.PORT ?? 13910);
const MAX_CACHE = 80;

type Cached = { body: Buffer };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Buffer | null>>();

function remember(key: string, body: Buffer): void {
  cache.delete(key);
  cache.set(key, { body });
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function fetchOriginal(key: string): Promise<Buffer | null> {
  const response = await fetch(`${origin}/${key}`, {
    headers: { host: assetHost },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) return null;
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > IMAGE_SOURCE_MAX_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > IMAGE_SOURCE_MAX_BYTES) return null;
  return bytes;
}

async function optimized(key: string, width: number, quality: number): Promise<Buffer | null> {
  const cacheKey = `${key}?w=${width}&q=${quality}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit.body;
  }
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  const job = (async () => {
    const original = await fetchOriginal(key);
    if (!original) return null;
    const output =
      (await renderWebp(original, width, quality)) ?? (await renderWebp(original, 800, 60));
    if (output) remember(cacheKey, output);
    return output;
  })().finally(() => {
    inflight.delete(cacheKey);
  });
  inflight.set(cacheKey, job);
  return job;
}

const server = createServer((request, response) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://images');
  if (url.pathname === '/health') {
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('ok');
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('Method not allowed');
    return;
  }
  const key = safeAssetKey(url.pathname);
  if (!key) {
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('Not found');
    return;
  }
  const size = imageDeliverySize({ w: url.searchParams.get('w'), q: url.searchParams.get('q') });
  void optimized(key, size.width, size.quality)
    .then((body) => {
      if (!body) {
        response.writeHead(404, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end('Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': 'image/webp',
        'content-length': String(body.byteLength),
        'cache-control': 'public, max-age=86400',
      });
      response.end(method === 'HEAD' ? undefined : body);
    })
    .catch(() => {
      if (response.headersSent) return;
      response.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end('Not found');
    });
});

server.listen(port, '0.0.0.0');
