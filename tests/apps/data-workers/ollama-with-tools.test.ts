import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { createOllamaWithToolsPromptRunner } from '../../../apps/data-workers/src/prompt-runners/ollamawithtools';
import type { ScanInput } from '../../../apps/data-workers/src/prompt-runners/types';

const eventId = '33333333-3333-4333-8333-333333333301';
const nearbyEventId = '33333333-3333-4333-8333-333333333302';
const farEventId = '33333333-3333-4333-8333-333333333303';
const oldEventId = '33333333-3333-4333-8333-333333333304';
const cancelledEventId = '33333333-3333-4333-8333-333333333305';
const nearPublisherId = '33333333-3333-4333-8333-333333333401';
const farPublisherId = '33333333-3333-4333-8333-333333333402';

const scanInput: ScanInput = {
  eventId,
  title: 'Konsert',
  description: 'En kväll med musik',
  venue: 'Helsingehus',
  startsAt: '2027-06-01T18:00:00.000Z',
  location: { lat: 61.3, lng: 17.07 },
  sourceUrl: 'https://example.com/konsert',
  links: [],
  externalId: 'cbis:1',
  workerId: 'visit-soderhamn',
  existingTags: [],
  source: {
    id: '33333333-3333-4333-8333-333333333399',
    slug: 'visit-soderhamn',
    trust: 'auto_publish',
  },
  organizer: { keys: ['kansli@example.com'], name: 'Föreningen' },
};

function answer(content: string) {
  return { role: 'assistant', content };
}

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{ function: { name, arguments: args } }],
  };
}

function scriptedFetch(replies: object[]) {
  const bodies: { tools?: { function: { name: string } }[]; format?: unknown; messages: { role: string; content: string }[] }[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = replies.shift();
    return new Response(JSON.stringify({ message: next ?? answer('{}') }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, bodies };
}

function storeWithNearbyRows() {
  const store = createMemoryIngestStore();
  store.publishers.push(
    {
      id: nearPublisherId,
      name: 'Hälsinglands museum',
      slug: 'halsinglands-museum',
      isTemporary: false,
      verified: true,
      importNotificationPlan: null,
      createdAt: 1,
    },
    {
      id: farPublisherId,
      name: 'Långt bort',
      slug: 'langt-bort',
      isTemporary: true,
      verified: false,
      importNotificationPlan: null,
      createdAt: 2,
    },
  );
  const nearbyStart = new Date('2027-06-01T20:00:00.000Z');
  store.events.push(
    {
      id: eventId,
      publisherId: null,
      title: 'Konsert',
      description: null,
      status: 'pending_scan',
      origin: 'imported',
      sourceUrl: 'https://example.com/konsert',
      startsAt: new Date(scanInput.startsAt),
      endsAt: nearbyStart,
      venueName: 'Helsingehus',
      location: { lat: 61.3, lng: 17.07 },
      tagIds: [],
      meta: {},
    },
    {
      id: nearbyEventId,
      publisherId: nearPublisherId,
      title: 'Marknad på torget',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://example.com/marknad',
      startsAt: nearbyStart,
      endsAt: nearbyStart,
      venueName: 'Stortorget',
      location: { lat: 61.301, lng: 17.07 },
      tagIds: [],
      meta: {},
    },
    {
      id: farEventId,
      publisherId: farPublisherId,
      title: 'Konsert i Hudiksvall',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://example.com/hudik',
      startsAt: nearbyStart,
      endsAt: nearbyStart,
      venueName: 'Folkets hus',
      location: { lat: 61.73, lng: 17.1 },
      tagIds: [],
      meta: {},
    },
    {
      id: oldEventId,
      publisherId: nearPublisherId,
      title: 'Gammal marknad',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://example.com/gammal',
      startsAt: new Date('2020-01-01T18:00:00.000Z'),
      endsAt: new Date('2020-01-01T20:00:00.000Z'),
      venueName: 'Stortorget',
      location: { lat: 61.301, lng: 17.07 },
      tagIds: [],
      meta: {},
    },
    {
      id: cancelledEventId,
      publisherId: nearPublisherId,
      title: 'Inställd marknad',
      description: null,
      status: 'cancelled',
      origin: 'imported',
      sourceUrl: 'https://example.com/installd',
      startsAt: nearbyStart,
      endsAt: nearbyStart,
      venueName: 'Stortorget',
      location: { lat: 61.301, lng: 17.07 },
      tagIds: [],
      meta: {},
    },
  );
  return store;
}

const finalAnswer = answer(
  JSON.stringify({
    contentVerdict: 'safe',
    summary: 'Musik i Helsingehus',
    language: 'sv',
    possibleTags: [
      { id: 'visit-soderhamn:30194', score: 95 },
      { id: 'missing-tag', score: 99 },
    ],
  }),
);

describe('createOllamaWithToolsPromptRunner', () => {
  it('sends tool definitions and returns nearby events the model asked for', async () => {
    const store = storeWithNearbyRows();
    const { fetchImpl, bodies } = scriptedFetch([
      toolCall('getNearbyEvents', { lat: 61.3, lng: 17.07 }),
      finalAnswer,
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(bodies[0]?.format).toBeUndefined();
    expect(bodies[0]?.tools?.map((tool) => tool.function.name)).toEqual([
      'getNearbyEvents',
      'getNearbyPublishers',
      'getAvailableTags',
    ]);
    expect(bodies[0]?.messages[0]?.content).toContain('getNearbyEvents');
    const toolMessage = bodies[1]?.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('Marknad på torget');
    expect(toolMessage?.content).not.toContain('Konsert i Hudiksvall');
    expect(toolMessage?.content).not.toContain('Gammal marknad');
    expect(toolMessage?.content).not.toContain('Inställd marknad');
    expect(toolMessage?.content).not.toContain(eventId);
    expect(outcome).toMatchObject({
      ok: true,
      summary: 'Musik i Helsingehus',
      language: 'sv',
      contentVerdict: 'safe',
      tags: [{ externalId: 'visit-soderhamn:30194', name: 'Bandy & Innebandy' }],
      publisher: { kind: 'temporary', name: 'Föreningen' },
      duplicate: null,
    });
  });

  it('returns publishers that have an event near the point', async () => {
    const store = storeWithNearbyRows();
    const { fetchImpl, bodies } = scriptedFetch([
      toolCall('getNearbyPublishers', { lat: 61.3, lng: 17.07 }),
      finalAnswer,
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    await runner.scan([scanInput]);

    const toolMessage = bodies[1]?.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('Hälsinglands museum');
    expect(toolMessage?.content).not.toContain('Långt bort');
  });

  it('returns the tag catalog and rejects a coordinate outside the valid range', async () => {
    const store = storeWithNearbyRows();
    const { fetchImpl, bodies } = scriptedFetch([
      toolCall('getAvailableTags', {}),
      toolCall('getNearbyEvents', { lat: 200, lng: 17.07 }),
      finalAnswer,
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    await runner.scan([scanInput]);

    const tags = bodies[1]?.messages.find((message) => message.role === 'tool');
    const rejected = bodies[2]?.messages.filter((message) => message.role === 'tool').at(-1);
    expect(tags?.content).toContain('"id":"visit-soderhamn:30194"');
    expect(tags?.content).toContain('Bandy & Innebandy');
    expect(rejected?.content).toContain('lat must be a number');
    expect(rejected?.content).not.toContain('Marknad på torget');
  });

  it('rejects a blank coordinate instead of searching at latitude zero', async () => {
    const store = storeWithNearbyRows();
    const { fetchImpl, bodies } = scriptedFetch([
      toolCall('getNearbyEvents', { lat: '', lng: 17.07 }),
      finalAnswer,
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    await runner.scan([scanInput]);

    const toolMessage = bodies[1]?.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('lat must be a number');
    expect(toolMessage?.content).not.toContain('Marknad på torget');
  });

  it('leaves the scan unavailable when the model reply has no text', async () => {
    const store = createMemoryIngestStore();
    const { fetchImpl } = scriptedFetch([{ role: 'assistant' }]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(outcome).toEqual({ ok: false, eventId, reason: 'unavailable' });
  });

  it('leaves the scan unavailable when every round is another tool call', async () => {
    const store = createMemoryIngestStore();
    const { fetchImpl } = scriptedFetch([
      toolCall('getAvailableTags', {}),
      toolCall('getAvailableTags', {}),
      toolCall('getAvailableTags', {}),
      toolCall('getAvailableTags', {}),
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(outcome).toEqual({ ok: false, eventId, reason: 'unavailable' });
  });
});
