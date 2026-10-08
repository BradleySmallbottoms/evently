import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('admin api', () => {
  it('responds on /health', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'admin-api' });
  });
  it('serves the OpenAPI document', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/health']).toBeDefined();
  });
});
