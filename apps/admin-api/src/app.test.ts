import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createMemoryAdminPublisherServices } from './services/publishers';

describe('admin api', () => {
  it('responds on /health', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'admin-api' });
  });

  it('serves the OpenAPI document with publisher routes', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    // Paths are relative to API_PREFIX; clients set baseUrl to …/v1.
    expect(doc.paths['/publishers']).toBeDefined();
    expect(doc.paths['/publishers/{id}/verify']).toBeDefined();
  });

  it('lists unverified publishers and verifies them', async () => {
    const publishers = new Map([
      [
        '22222222-2222-4222-8222-222222222201',
        {
          id: '22222222-2222-4222-8222-222222222201',
          name: 'Cafe',
          slug: 'cafe',
          type: 'org' as const,
          verified: false,
          origin: 'native' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    ]);
    const events = new Map([
      [
        '33333333-3333-4333-8333-333333333301',
        {
          id: '33333333-3333-4333-8333-333333333301',
          publisherId: '22222222-2222-4222-8222-222222222201',
          status: 'awaiting_verification',
          endsAtDate: new Date('2026-12-01T21:00:00Z'),
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);
    const app = createApp({
      publishers: createMemoryAdminPublisherServices({ publishers, events }),
    });

    const list = await app.request('/v1/publishers?verified=false');
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const verify = await app.request(
      '/v1/publishers/22222222-2222-4222-8222-222222222201/verify',
      { method: 'POST' },
    );
    expect(verify.status).toBe(200);
    expect(await verify.json()).toMatchObject({
      verified: true,
      releasedEventCount: 1,
    });
    expect(events.get('33333333-3333-4333-8333-333333333301')?.status).toBe('published');
  });

  it('returns empty list when verified=true and 404 on unknown verify id', async () => {
    const app = createApp({
      publishers: createMemoryAdminPublisherServices({ publishers: new Map(), events: new Map() }),
    });

    const verified = await app.request('/v1/publishers?verified=true');
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ items: [] });

    const missing = await app.request('/v1/publishers/00000000-0000-4000-8000-000000000000/verify', {
      method: 'POST',
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: 'not_found' },
    });
  });
});
