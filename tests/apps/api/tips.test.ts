import { describe, expect, it } from 'vitest';
import { TIP_IMAGE_MAX_BYTES } from '../../../packages/domain/src/tips';
import { createApp } from '../../../apps/api/src/app';
import { tipImageStoreFromEnv } from '../../../apps/api/src/services/tips/db';
import type { TipModel } from '../../../apps/api/src/services/tips/anthropic';
import type { Tip } from '../../../packages/contracts/src/tips';

const model: TipModel = {
  async extract(input) {
    if (input.image && input.image.bytes.byteLength < 20) {
      return { extraction: {}, followUpQuestions: [] };
    }
    const extraction = {
      title: 'Sommarkonsert',
      startsAt: '2026-08-24T17:00:00.000Z',
      place: 'Stadsparken, Söderhamn',
      priceLabel: 'Gratis',
      link: 'https://stad.se/sommarkonsert',
      description: 'En kväll med The River Band.',
      tags: [...(input.tags ?? []).map((tag) => tag.name), 'Nope'],
    };
    return { extraction, followUpQuestions: [] };
  },
};

function app() {
  return createApp({
    tipModel: model,
    tipTags: async () => [{ id: 'musik', name: 'Musik' }],
  });
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
    const asking = await json<Tip>(read);
    expect(asking.phase).toBe('collecting');
    expect(asking.progress).toEqual({ done: 7, total: 9 });
    expect(asking.question?.key).toBe('endDate');
    expect(asking.question?.options).toEqual([{ label: 'Jag vet inte', reply: 'endDate: none' }]);
    expect(asking.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(asking.messages[1]?.key).toBe('endDate');

    const ended = await api.request(`/v1/me/tips/${tip.id}/text`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'endDate: none' }),
    });
    expect(ended.status).toBe(200);
    const withEnd = await json<Tip>(ended);
    expect(withEnd.phase).toBe('collecting');
    expect(withEnd.progress).toEqual({ done: 9, total: 9 });
    expect(withEnd.question?.key).toBe('image');

    const skipped = await api.request(`/v1/me/tips/${tip.id}/text`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'image: none' }),
    });
    expect(skipped.status).toBe(200);
    const ready = await json<Tip>(skipped);
    expect(ready.phase).toBe('confirm');
    expect(ready.question).toBeNull();
    expect(ready.card).toMatchObject({
      title: 'Sommarkonsert',
      place: 'Stadsparken, Söderhamn',
      priceLabel: 'Gratis',
      tags: ['Musik'],
    });

    const submitted = await api.request(`/v1/me/tips/${tip.id}/confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ card: ready.card }),
    });
    expect(submitted.status).toBe(200);
    const done = await json<Tip>(submitted);
    expect(done.phase).toBe('receipt');
    expect(done.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(done.found?.category).toBeNull();

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

  it('reads a photo into the chat instead of submitting it', async () => {
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
    let current = await json<Tip>(uploaded);
    expect(current.phase).toBe('collecting');
    expect(current.messages.some((message) => message.key === 'image')).toBe(true);
    for (let attempt = 0; attempt < 20 && current.question?.key !== 'endDate'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      current = await json<Tip>(await api.request(`/v1/me/tips/${created.id}`, { headers }));
    }
    expect(current.imageStatus).toBe('ready');
    expect(current.phase).toBe('collecting');
    expect(current.question?.key).toBe('endDate');
  });

  it('does not record an image when the asset bucket is missing', async () => {
    const store = tipImageStoreFromEnv({});
    await expect(store.put('tips/a/b.jpg', new Uint8Array([1]), 'image/jpeg')).rejects.toThrow(
      'tip_image_bucket_missing',
    );
  });
});
