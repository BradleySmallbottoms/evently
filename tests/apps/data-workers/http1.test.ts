import { describe, expect, it, vi } from 'vitest';
import {
  DESTINATION_HALSINGLAND_USER_AGENT,
  fetchPublicDocument,
} from '../../../apps/data-workers/src/http1';

describe('fetchPublicDocument', () => {
  it('fetches visit.destinationhalsingland.se with curl and the Postman user agent', async () => {
    const curl = vi.fn(async () => new Response('ok', { status: 200 }));
    const base = vi.fn(async () => new Response('node', { status: 200 }));

    await fetchPublicDocument(
      'https://visit.destinationhalsingland.se/sv/se-gora/2882687/kurs/detaljer',
      { headers: { accept: 'text/html' } },
      base,
      curl,
    );

    expect(base).not.toHaveBeenCalled();
    expect(curl).toHaveBeenCalledOnce();
    const init = curl.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('user-agent')).toBe(DESTINATION_HALSINGLAND_USER_AGENT);
    expect(headers.get('accept')).toBe('text/html');
  });

  it('keeps node fetch for every other host', async () => {
    const curl = vi.fn(async () => new Response('ok', { status: 200 }));
    const base = vi.fn(async () => new Response('node', { status: 200 }));

    await fetchPublicDocument('https://foreningen.se/om', undefined, base, curl);

    expect(curl).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledOnce();
  });
});
