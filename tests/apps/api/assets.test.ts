import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../apps/api/src/app';

describe('local asset proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves a Garage image through the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );
    const app = createApp({
      assetsPublicBaseUrl: 'http://local-events-assets.localhost:3902',
    });
    const res = await app.request('/v1/assets/events/abc/main');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://local-events-assets.localhost:3902/events/abc/main',
      { redirect: 'manual' },
    );
  });

  it('does not proxy when the public asset host is not local', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = createApp({ assetsPublicBaseUrl: 'https://d111.cloudfront.net' });
    const res = await app.request('/v1/assets/events/abc/main');
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a path that escapes the bucket', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = createApp({
      assetsPublicBaseUrl: 'http://local-events-assets.localhost:3902',
    });
    const res = await app.request('/v1/assets/events/../../secret');
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
