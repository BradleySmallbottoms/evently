import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { renderWebp } from '../../infra/image-optimizer/resize';
import { readWebsiteObject } from '../../infra/image-optimizer/website';

const sharp = createRequire(new URL('../../infra/image-optimizer/resize.ts', import.meta.url))(
  'sharp',
) as typeof import('sharp');

describe('renderWebp', () => {
  it('returns a WebP and does not enlarge a small image', async () => {
    const png = await sharp({
      create: { width: 32, height: 16, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const output = await renderWebp(png, 1600, 75);
    expect(output).not.toBeNull();
    const meta = await sharp(output!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(16);
  });

  it('scales a wide image down to the requested width', async () => {
    const png = await sharp({
      create: { width: 800, height: 400, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const output = await renderWebp(png, 400, 75);
    const meta = await sharp(output!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(200);
  });

  it('returns null for bytes that are not an image', async () => {
    expect(await renderWebp(Buffer.from('not an image'), 800, 75)).toBeNull();
  });
});

describe('readWebsiteObject', () => {
  it('sends the bucket host Garage expects', async () => {
    const seen: string[] = [];
    const server = createServer((request, response) => {
      seen.push(String(request.headers.host));
      response.writeHead(200, { 'content-type': 'image/jpeg' });
      response.end('jpeg-bytes');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address == null || typeof address === 'string') throw new Error('no port');
    try {
      const body = await readWebsiteObject({
        origin: `http://127.0.0.1:${address.port}`,
        host: 'local-events-assets.localhost',
        key: 'events/abc/main',
        maxBytes: 1000,
      });
      expect(body?.toString()).toBe('jpeg-bytes');
      expect(seen).toEqual(['local-events-assets.localhost']);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
