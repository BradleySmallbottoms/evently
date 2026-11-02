import { describe, expect, it } from 'vitest';

import {
  focalFromModelText,
  IMAGE_FOCAL_MAX_BYTES,
  scanPendingImageFocals,
} from '../../../apps/data-workers/src/image-focal';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

async function save(store: ReturnType<typeof createMemoryIngestStore>, role = 'main') {
  await store.saveEventImage({
    eventId: EVENT_ID,
    role,
    s3Key: `events/${EVENT_ID}/${role}`,
    sourceUrl: `https://images.example/${role}.jpg`,
    contentType: 'image/jpeg',
  });
}

describe('focalFromModelText', () => {
  it('reads a JSON point, including one wrapped in a fence', () => {
    expect(focalFromModelText('{"x":0.2,"y":0.4}')).toEqual({ x: 0.2, y: 0.4 });
    expect(focalFromModelText('```json\n{"x": 0.5, "y": 0.1}\n```')).toEqual({ x: 0.5, y: 0.1 });
  });

  it('refuses prose and a point off the photo', () => {
    expect(focalFromModelText('the face is on the left')).toBeNull();
    expect(focalFromModelText('{"x": 2, "y": 0.4}')).toBeNull();
  });
});

describe('scanPendingImageFocals', () => {
  it('stores the model point and leaves a poster unclaimed', async () => {
    const store = createMemoryIngestStore();
    await save(store);
    await save(store, 'poster');
    const summary = await scanPendingImageFocals(store, {
      readImage: async () => new Uint8Array([1, 2, 3]),
      ask: async () => ({ text: '{"x":0.3,"y":0.6}', output: { x: 0.3, y: 0.6 } }),
    });
    expect(summary).toMatchObject({ claimed: 1, done: 1, failed: 0, unavailable: 0 });
    const hero = store.images.find((image) => image.role === 'main');
    expect(hero).toMatchObject({ focalStatus: 'done', focalX: 0.3, focalY: 0.6 });
    expect(store.images.find((image) => image.role === 'poster')?.focalStatus).toBe('pending');
  });

  it('releases the lease when the asset store or the model fails', async () => {
    const store = createMemoryIngestStore();
    await save(store);
    const storage = await scanPendingImageFocals(store, {
      readImage: async () => {
        throw new Error('storage');
      },
      ask: async () => ({ text: '{"x":0.1,"y":0.1}', output: {} }),
    });
    expect(storage.unavailable).toBe(1);
    expect(storage.released).toEqual([store.images[0]!.id]);
    expect(store.images[0]).toMatchObject({ focalStatus: 'pending', focalClaimedUntil: null });
  });

  it('releases the lease when the model does not answer', async () => {
    const store = createMemoryIngestStore();
    await save(store);
    const summary = await scanPendingImageFocals(store, {
      readImage: async () => new Uint8Array([1]),
      ask: async () => 'timeout',
    });
    expect(summary.unavailable_timeout).toBe(1);
    expect(summary.released).toHaveLength(1);
    expect(store.images[0]).toMatchObject({ focalStatus: 'pending', focalClaimedUntil: null });
  });

  it('marks an answer that is not a point as failed', async () => {
    const store = createMemoryIngestStore();
    await save(store);
    const summary = await scanPendingImageFocals(store, {
      readImage: async () => new Uint8Array([1]),
      ask: async () => ({ text: 'no point here', output: { text: 'no point here' } }),
    });
    expect(summary.failed).toBe(1);
    expect(store.images[0]?.focalStatus).toBe('failed');
    const again = await scanPendingImageFocals(store, {
      readImage: async () => new Uint8Array([1]),
      ask: async () => ({ text: '{"x":0.1,"y":0.1}', output: {} }),
    });
    expect(again.claimed).toBe(0);
  });

  it('does not send a file the model cannot accept', async () => {
    const store = createMemoryIngestStore();
    await save(store);
    let asked = false;
    const summary = await scanPendingImageFocals(store, {
      readImage: async () => new Uint8Array(IMAGE_FOCAL_MAX_BYTES + 1),
      ask: async () => {
        asked = true;
        return { text: '{"x":0.5,"y":0.5}', output: {} };
      },
    });
    expect(asked).toBe(false);
    expect(summary.failed).toBe(1);
    expect(store.images[0]?.focalOutput).toEqual({ error: 'too_large' });
  });

  it('clears a stored point when the image is replaced', async () => {
    const store = createMemoryIngestStore();
    await save(store);
    await scanPendingImageFocals(store, {
      readImage: async () => new Uint8Array([1]),
      ask: async () => ({ text: '{"x":0.2,"y":0.2}', output: {} }),
    });
    await store.saveEventImage({
      eventId: EVENT_ID,
      s3Key: `events/${EVENT_ID}/main`,
      sourceUrl: 'https://images.example/replaced.jpg',
      contentType: 'image/jpeg',
    });
    expect(store.images[0]).toMatchObject({
      focalStatus: 'pending',
      focalX: null,
      focalY: null,
    });
  });
});
