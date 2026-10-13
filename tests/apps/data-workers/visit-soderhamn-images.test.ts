import type { SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it } from 'vitest';
import {
  crawlLinkImages,
  imagesFromHtml,
} from '../../../apps/data-workers/src/sources/visit-soderhamn/page-images';

const page = 'https://example.com/event';

function ctx(fetchImpl: SourceRunContext['fetch']): SourceRunContext {
  return {
    sourceSlug: 'visit-soderhamn',
    config: {},
    fetch: fetchImpl,
    log: () => {},
  };
}

describe('imagesFromHtml', () => {
  it('reads og images before img tags and resolves relative urls', () => {
    const found = imagesFromHtml(
      `<html><head>
        <meta property="og:image" content="/photos/og.jpg">
        <meta name="og:image:secure_url" content="https://cdn.example/secure.jpg">
      </head><body>
        <img src="photo.jpg" width="640" height="480">
        <img src="pixel.gif" width="1" height="1">
        <img src="https://cdn.example/icon-16x16.png">
        <img data-src="https://cdn.example/lazy.jpg" src="data:image/gif;base64,aaaa">
        <img src="http://127.0.0.1/secret.jpg" width="800" height="600">
      </body></html>`,
      page,
    );
    expect(found.og).toEqual([
      'https://example.com/photos/og.jpg',
      'https://cdn.example/secure.jpg',
    ]);
    expect(found.img).toEqual(['https://example.com/photo.jpg', 'https://cdn.example/lazy.jpg']);
  });

  it('picks the widest srcset candidate', () => {
    const found = imagesFromHtml(
      '<img src="data:image/gif;base64,aaaa" srcset="small.jpg 400w, large.jpg 1200w">',
      page,
    );
    expect(found.img).toEqual(['https://example.com/large.jpg']);
  });
});

describe('crawlLinkImages', () => {
  it('does not follow a redirect onto a private host', async () => {
    const calls: string[] = [];
    const result = await crawlLinkImages(
      ctx(async (input, init) => {
        calls.push(String(input));
        expect(init?.redirect).toBe('manual');
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/secret' },
        });
      }),
      [{ id: 'product', urls: ['https://example.com/event'] }],
    );
    expect(calls).toEqual(['https://example.com/event']);
    expect(result.product).toBeNull();
  });

  it('keeps images from a page that loaded when another link failed', async () => {
    const result = await crawlLinkImages(
      ctx(async (input) => {
        const url = String(input);
        if (url.endsWith('/tickets')) return new Response('nope', { status: 404 });
        return new Response(
          '<html><meta property="og:image" content="https://cdn.example/og.jpg"></html>',
          {
            status: 200,
            headers: { 'content-type': 'text/html' },
          },
        );
      }),
      [{ id: 'product', urls: ['https://example.com/tickets', 'https://example.com/event'] }],
    );
    expect(result.product).toEqual(['https://cdn.example/og.jpg']);
  });
});
