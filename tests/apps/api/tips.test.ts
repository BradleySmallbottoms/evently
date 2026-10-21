import { describe, expect, it } from 'vitest';
import { TIP_IMAGE_MAX_BYTES } from '../../../packages/domain/src/tips';
import { createApp } from '../../../apps/api/src/app';
import type { TipModel } from '../../../apps/api/src/services/tips/anthropic';
import type { Tip } from '../../../packages/contracts/src/tips';

const model: TipModel = {
  async extract(input) {
    if (input.image && input.image.byteLength < 20) return {};
    return {
      title: 'Sommarkonsert',
      startsAt: '2026-08-24T17:00:00.000Z',
      place: 'Stadsparken, Söderhamn',
      priceLabel: 'Gratis',
      link: 'https://stad.se/sommarkonsert',
      description: 'En kväll med The River Band.',
    };
  },
};

function app() {
  return createApp({ tipModel: model });
}

async function session(api: ReturnType<typeof createApp>) {
  const created = await api.request('/v1/identities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as { sessionToken: string };
  return { Authorization: `Bearer ${body.sessionToken}` };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('event tips', () => {
  it('reads a description, asks for the follow-up, then submits', async () => {
    const api = app();
    const headers = { ...(await session(api)), 'content-type': 'application/json' };
    const created = await api.request('/v1/me/tips', {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: 'text', locale: 'sv' }),
    });
    expect(created.status).toBe(201);
    const tip = await json<Tip>(created);

    const read = await api.request(`/v1/me/tips/${tip.id}/text`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'Sommarkonsert i Stadsparken den 24 augusti. Gratis. https://stad.se/sommarkonsert',
      }),
    });
    expect(read.status).toBe(200);
    const card = await json<Tip>(read);
    expect(card.phase).toBe('confirm');
    expect(card.card).toMatchObject({
      title: 'Sommarkonsert',
      place: 'Stadsparken, Söderhamn',
      priceLabel: 'Gratis',
    });

    const follow = await api.request(`/v1/me/tips/${tip.id}/confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ card: card.card }),
    });
    expect(follow.status).toBe(200);
    expect((await json<Tip>(follow)).phase).toBe('follow_up');

    const submitted = await api.request(`/v1/me/tips/${tip.id}/confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ categoryHint: 'Musik', submitFollowUp: true }),
    });
    expect(submitted.status).toBe(200);
    const done = await json<Tip>(submitted);
    expect(done.phase).toBe('receipt');
    expect(done.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(done.found?.category).toBe('Musik');

    const other = await session(api);
    const hidden = await api.request(`/v1/me/tips/${tip.id}`, { headers: other });
    expect(hidden.status).toBe(404);
  });

  it('rejects a description over 500 characters and an oversized image', async () => {
    const api = app();
    const headers = { ...(await session(api)), 'content-type': 'application/json' };
    const created = await json<Tip>(
      await api.request('/v1/me/tips', {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: 'text' }),
      }),
    );
    const long = await api.request(`/v1/me/tips/${created.id}/text`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'a'.repeat(501) }),
    });
    expect(long.status).toBe(400);

    const photo = await json<Tip>(
      await api.request('/v1/me/tips', {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: 'photo' }),
      }),
    );
    const tooBig = await api.request(`/v1/me/tips/${photo.id}/images`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contentType: 'image/jpeg',
        dataBase64: Buffer.alloc(TIP_IMAGE_MAX_BYTES + 1, 1).toString('base64'),
      }),
    });
    expect(tooBig.status).toBe(400);
    const body = (await tooBig.json()) as { error: { code: string } };
    expect(body.error.code).toBe('too_large');
  });

  it('submits a photo once the title is read', async () => {
    const api = app();
    const headers = { ...(await session(api)), 'content-type': 'application/json' };
    const created = await json<Tip>(
      await api.request('/v1/me/tips', {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: 'photo' }),
      }),
    );
    const uploaded = await api.request(`/v1/me/tips/${created.id}/images`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contentType: 'image/jpeg',
        dataBase64: Buffer.from('not-a-real-image-but-long-enough').toString('base64'),
      }),
    });
    expect(uploaded.status).toBe(200);
    let phase = '';
    for (let attempt = 0; attempt < 20 && phase !== 'receipt'; attempt += 1) {
      const current = await json<Tip>(await api.request(`/v1/me/tips/${created.id}`, { headers }));
      phase = current.phase;
      if (phase !== 'receipt') await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(phase).toBe('receipt');
  });
});
