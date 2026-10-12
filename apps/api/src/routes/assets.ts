import type { OpenAPIHono } from '@hono/zod-openapi';
import { isLocalAssetHost, publicAssetUrl, safeAssetKey } from '@local-events/domain';

/**
 * Phones cannot open Garage at `*.localhost`. This serves that same object from
 * the API host the app already uses. CloudFront URLs are not proxied.
 */
export function registerAssetRoutes(app: OpenAPIHono, assetsPublicBaseUrl?: string): void {
  app.get('/assets/*', async (c) => {
    const base = assetsPublicBaseUrl?.trim();
    if (!base) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    let baseHost: string;
    try {
      baseHost = new URL(base).hostname;
    } catch {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }
    if (!isLocalAssetHost(baseHost)) {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }

    const pathname = new URL(c.req.url).pathname;
    const raw = pathname.split('/assets/')[1] ?? '';
    const key = safeAssetKey(raw);
    const upstream = key ? publicAssetUrl(base, key) : null;
    if (!upstream) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);

    const res = await fetch(upstream, { redirect: 'manual' });
    const type = res.headers.get('content-type') ?? '';
    if (res.status !== 200 || !type.startsWith('image/') || !res.body) {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  });
}
