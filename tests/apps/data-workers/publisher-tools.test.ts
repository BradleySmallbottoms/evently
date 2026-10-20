import { describe, expect, it } from 'vitest';
import {
  createPublisherToolSession,
  executePublisherTool,
  loadPublicHtml,
  publisherProfileFromModel,
  type PublisherToolDeps,
  type PublisherToolSession,
} from '../../../apps/data-workers/src/publisher-tools';

const publicHost = async () => ['93.184.216.34'];

function deps(fetchImpl: typeof fetch, braveApiKey = 'test-key'): PublisherToolDeps {
  return { fetch: fetchImpl, resolveHost: publicHost, braveApiKey };
}

function session(): PublisherToolSession {
  return createPublisherToolSession();
}

describe('searchWeb', () => {
  it('asks Brave for Sweden in Swedish and maps the results', async () => {
    let requested = '';
    const fetchImpl: typeof fetch = async (url, init) => {
      requested = String(url);
      expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('test-key');
      return Response.json({
        web: {
          results: [
            { title: 'Föreningen', url: 'https://foreningen.se/om', description: 'Officiell sida' },
            { title: '', url: 'https://skip.example' },
          ],
        },
      });
    };

    const result = await executePublisherTool('searchWeb', { query: 'Föreningen Söderhamn' }, session(), deps(fetchImpl));

    const url = new URL(requested);
    expect(url.searchParams.get('country')).toBe('SE');
    expect(url.searchParams.get('search_lang')).toBe('sv');
    expect(url.searchParams.get('count')).toBe('5');
    expect(result).toEqual({
      results: [{ title: 'Föreningen', url: 'https://foreningen.se/om', description: 'Officiell sida' }],
    });
  });

  it('returns an error when the API key is missing and does not fetch', async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return Response.json({});
    };

    const result = await executePublisherTool(
      'searchWeb',
      { query: 'Föreningen' },
      session(),
      deps(fetchImpl, ''),
    );

    expect(result).toEqual({ error: 'Web search is not configured.' });
    expect(called).toBe(false);
  });

  it('stops after two searches', async () => {
    const fetchImpl: typeof fetch = async () => Response.json({ web: { results: [] } });
    const state = session();
    const options = deps(fetchImpl);
    await executePublisherTool('searchWeb', { query: 'ett' }, state, options);
    await executePublisherTool('searchWeb', { query: 'två' }, state, options);
    const third = await executePublisherTool('searchWeb', { query: 'tre' }, state, options);
    expect(third).toEqual({ error: 'Search limit reached.' });
  });
});

describe('fetchPage', () => {
  it('refuses a URL that is not https', async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response('no');
    };
    const result = await executePublisherTool(
      'fetchPage',
      { url: 'http://foreningen.se/om' },
      session(),
      deps(fetchImpl),
    );
    expect(result).toEqual({ error: 'url must be an https URL.' });
    expect(called).toBe(false);
  });

  it('refuses a loopback address and a host that resolves to a private address', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response('no');
    };
    const options = deps(fetchImpl);
    expect(await executePublisherTool('fetchPage', { url: 'https://127.0.0.1/secret' }, session(), options)).toEqual({
      error: 'That address is not allowed.',
    });
    expect(
      await executePublisherTool('fetchPage', { url: 'https://10.1.2.3/secret' }, session(), options),
    ).toEqual({ error: 'That address is not allowed.' });
    const resolved = await executePublisherTool(
      'fetchPage',
      { url: 'https://foreningen.se/secret' },
      session(),
      { ...options, resolveHost: async () => ['192.168.1.1'] },
    );
    expect(resolved).toEqual({ error: 'That address is not allowed.' });
    expect(calls).toEqual([]);
  });

  it('does not follow a redirect onto a private address', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/admin' } });
    };
    const result = await executePublisherTool(
      'fetchPage',
      { url: 'https://foreningen.se/om' },
      session(),
      deps(fetchImpl),
    );
    expect(result).toEqual({ error: 'That address is not allowed.' });
    expect(calls).toEqual(['https://foreningen.se/om']);
  });

  it('sends a cookie from a redirect on the next request', async () => {
    const seen: { url: string; cookie: string | null }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const cookie = new Headers(init?.headers).get('cookie');
      seen.push({ url: String(url), cookie });
      if (String(url) === 'https://foreningen.se/om') {
        const headers = new Headers({ location: 'https://foreningen.se/in' });
        headers.append('set-cookie', 'sid=abc; Domain=.foreningen.se; Path=/');
        headers.append('set-cookie', 'other=no; Domain=evil.example');
        return new Response(null, { status: 302, headers });
      }
      return new Response('<html><head><title>Inne</title></head><body><p>Hej</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    const loaded = await loadPublicHtml('https://foreningen.se/om', deps(fetchImpl));

    expect(seen).toEqual([
      { url: 'https://foreningen.se/om', cookie: null },
      { url: 'https://foreningen.se/in', cookie: 'sid=abc' },
    ]);
    expect(loaded).toMatchObject({ url: 'https://foreningen.se/in', html: expect.stringContaining('Hej') });
  });

  it('keeps a host cookie off a redirect to another site', async () => {
    const seen: { url: string; cookie: string | null }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), cookie: new Headers(init?.headers).get('cookie') });
      if (seen.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://other.example/in', 'set-cookie': 'sid=abc; Path=/' },
        });
      }
      return new Response('<html><head><title>Annan</title></head><body><p>Hej</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    await loadPublicHtml('https://foreningen.se/om', deps(fetchImpl));

    expect(seen[1]).toEqual({ url: 'https://other.example/in', cookie: null });
  });

  it('does not send a parent-domain cookie to another site on that suffix', async () => {
    const seen: { url: string; cookie: string | null }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), cookie: new Headers(init?.headers).get('cookie') });
      if (seen.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location: 'https://victim.github.io/in',
            'set-cookie': 'sid=secret; Domain=github.io; Path=/',
          },
        });
      }
      return new Response('<html><head><title>Annan</title></head><body><p>Hej</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    await loadPublicHtml('https://evil.github.io/start', deps(fetchImpl));

    expect(seen[1]).toEqual({ url: 'https://victim.github.io/in', cookie: null });
  });

  it('returns the title, excerpt, and schema.org event', async () => {
    const html = `<html><head><title>Föreningen</title>
      <script type="application/ld+json">
        {"@type":"Event","name":"Årsmöte","startDate":"2027-06-01","location":{"@type":"Place","name":"Helsingehus"}}
      </script>
      <style>.x{color:red}</style>
      </head><body><p>Storgatan 1, Söderhamn</p><script>alert(1)</script></body></html>`;
    const fetchImpl: typeof fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

    const result = await executePublisherTool(
      'fetchPage',
      { url: 'https://foreningen.se/om' },
      session(),
      deps(fetchImpl),
    );

    expect(result).toEqual({
      title: 'Föreningen',
      url: 'https://foreningen.se/om',
      text: 'Storgatan 1, Söderhamn',
      events: [
        {
          name: 'Årsmöte',
          startDate: '2027-06-01',
          endDate: null,
          url: null,
          venue: 'Helsingehus',
        },
      ],
    });
  });
});

describe('publisherProfileFromModel', () => {
  it('keeps a website only when that host was fetched', () => {
    const text = JSON.stringify({
      name: 'Föreningen',
      website: 'https://www.foreningen.se/om?ref=1',
      address: 'Storgatan 1',
      city: 'Söderhamn',
      description: 'En lokal förening',
      sources: [{ url: 'https://foreningen.se/om' }, { url: 'https://evil.example/om' }],
    });
    expect(publisherProfileFromModel(text, ['https://foreningen.se/om'])).toEqual({
      name: 'Föreningen',
      website: 'https://www.foreningen.se/om',
      address: 'Storgatan 1',
      city: 'Söderhamn',
      description: 'En lokal förening',
      sources: [{ url: 'https://foreningen.se/om' }],
    });
    const invented = JSON.stringify({ website: 'https://other.example' });
    expect(publisherProfileFromModel(invented, ['https://foreningen.se/om'])?.website).toBeNull();
  });
});
