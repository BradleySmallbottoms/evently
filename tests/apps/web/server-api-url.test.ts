import { describe, expect, it } from 'vitest';
import { serverApiUrl } from '../../../apps/web/src/lib/server-api-url';

describe('serverApiUrl', () => {
  it('uses the in-network API_URL when the server has one', () => {
    expect(
      serverApiUrl({
        API_URL: 'http://api:13000/v1/',
        NEXT_PUBLIC_API_URL: 'https://api.example.com/v1',
      }),
    ).toBe('http://api:13000/v1');
  });

  it('falls back to the public URL, then localhost', () => {
    expect(serverApiUrl({ NEXT_PUBLIC_API_URL: 'https://api.example.com/v1' })).toBe(
      'https://api.example.com/v1',
    );
    expect(serverApiUrl({})).toBe('http://localhost:13000/v1');
  });
});
