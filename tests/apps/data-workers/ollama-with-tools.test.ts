import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { createOllamaWithToolsPromptRunner } from '../../../apps/data-workers/src/prompt-runners/chatwithtools';
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
      toolCall('getNearbyEvents', {}),
      finalAnswer,
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(bodies[0]?.format).toBeUndefined();
    expect(bodies[0]?.tools?.map((tool) => tool.function.name)).toEqual([
      'getNearbyEvents',
      'getNearbyPublishers',
      'getPublishersByName',
      'getPossiblePublishers',
      'getAvailableTags',
    ]);
    expect(bodies[0]?.tools?.find((tool) => tool.function.name === 'getNearbyEvents')?.function).not.toHaveProperty(
      'parameters.required',
    );
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
      toolCall('getNearbyPublishers', {}),
      finalAnswer,
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    await runner.scan([scanInput]);

    const toolMessage = bodies[1]?.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('Hälsinglands museum');
    expect(toolMessage?.content).not.toContain('Långt bort');
  });

  it('returns the tag catalog and publishers whose name matches within 50 km', async () => {
    const store = storeWithNearbyRows();
    const farNameId = '33333333-3333-4333-8333-333333333403';
    store.publishers.push({
      id: farNameId,
      name: 'Hälsinglands teater',
      slug: 'halsinglands-teater',
      isTemporary: false,
      verified: true,
      importNotificationPlan: null,
      createdAt: 3,
    });
    store.events.push({
      id: '33333333-3333-4333-8333-333333333306',
      publisherId: farNameId,
      title: 'Teater långt bort',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://example.com/teater',
      startsAt: new Date('2027-06-01T20:00:00.000Z'),
      endsAt: new Date('2027-06-01T22:00:00.000Z'),
      venueName: 'Teatern',
      location: { lat: 62.5, lng: 17.07 },
      tagIds: [],
      meta: {},
    });
    const { fetchImpl, bodies } = scriptedFetch([
      toolCall('getAvailableTags', {}),
      toolCall('getPublishersByName', { name: 'Hälsing*' }),
      toolCall('getPublishersByName', { name: '*' }),
      finalAnswer,
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    await runner.scan([scanInput]);

    const tags = bodies[1]?.messages.find((message) => message.role === 'tool');
    const matched = bodies[2]?.messages.filter((message) => message.role === 'tool').at(-1);
    const rejected = bodies[3]?.messages.filter((message) => message.role === 'tool').at(-1);
    expect(tags?.content).toContain('"id":"visit-soderhamn:30194"');
    expect(matched?.content).toContain('Hälsinglands museum');
    expect(matched?.content).not.toContain('Hälsinglands teater');
    expect(rejected?.content).toContain('at least one letter or number');
    expect(rejected?.content).not.toContain('Hälsinglands museum');
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

  it('calls ChatGPT with a bearer token and sends the tool result back by id', async () => {
    const store = createMemoryIngestStore();
    const seen: { url: string; authorization?: string; body: { model?: string; messages: { role: string; tool_call_id?: string }[] } }[] = [];
    const replies = [
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_tags', type: 'function', function: { name: 'getAvailableTags', arguments: '{}' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                contentVerdict: 'safe',
                summary: 'Musik i Helsingehus',
                language: 'sv',
                possibleTags: [{ id: 'visit-soderhamn:30194', score: 95 }],
              }),
            },
          },
        ],
      },
    ];
    const fetchImpl: typeof fetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(url),
        authorization: headers.get('authorization') ?? undefined,
        body: JSON.parse(String(init?.body)),
      });
      const next = replies.shift();
      return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const runner = createOllamaWithToolsPromptRunner(store, {
      fetch: fetchImpl,
      config: {
        chatUrl: 'https://api.openai.com/v1/chat/completions',
        chatModel: 'gpt-4.1-mini',
        chatAuth: 'test-key',
      },
    });

    const [outcome] = await runner.scan([scanInput]);

    expect(seen[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(seen[0]?.authorization).toBe('Bearer test-key');
    expect(seen[0]?.body.model).toBe('gpt-4.1-mini');
    expect(seen[1]?.body.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_tags')).toBe(true);
    expect(outcome).toMatchObject({
      ok: true,
      summary: 'Musik i Helsingehus',
      tags: [{ externalId: 'visit-soderhamn:30194', name: 'Bandy & Innebandy' }],
    });
  });

  it('calls Claude with an API key and sends tool results as tool_result blocks', async () => {
    const store = createMemoryIngestStore();
    const seen: { url: string; apiKey?: string; version?: string; body: { tools?: { name: string; input_schema?: object }[]; messages: { role: string; content?: unknown }[] } }[] = [];
    const replies = [
      {
        content: [{ type: 'tool_use', id: 'toolu_tags', name: 'getAvailableTags', input: {} }],
      },
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              contentVerdict: 'safe',
              summary: 'Musik i Helsingehus',
              language: 'en',
              possibleTags: [],
            }),
          },
        ],
      },
    ];
    const fetchImpl: typeof fetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(url),
        apiKey: headers.get('x-api-key') ?? undefined,
        version: headers.get('anthropic-version') ?? undefined,
        body: JSON.parse(String(init?.body)),
      });
      const next = replies.shift();
      return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const runner = createOllamaWithToolsPromptRunner(store, {
      fetch: fetchImpl,
      config: {
        chatUrl: 'https://api.anthropic.com/v1/messages',
        chatModel: 'claude-sonnet-4-5',
        chatAuth: 'test-key',
      },
    });

    const [outcome] = await runner.scan([scanInput]);

    expect(seen[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0]?.apiKey).toBe('test-key');
    expect(seen[0]?.version).toBe('2023-06-01');
    expect(seen[0]?.body.tools?.some((tool) => tool.name === 'getAvailableTags' && tool.input_schema)).toBe(true);
    const results = seen[1]?.body.messages.find((message) => message.role === 'user' && Array.isArray(message.content));
    expect(JSON.stringify(results?.content)).toContain('toolu_tags');
    expect(outcome).toMatchObject({ ok: true, language: 'en', summary: 'Musik i Helsingehus' });
  });

  it('does not call a chat URL that is not https or loopback', async () => {
    const store = createMemoryIngestStore();
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };
    const runner = createOllamaWithToolsPromptRunner(store, {
      fetch: fetchImpl,
      config: { chatUrl: 'http://10.0.0.8/v1/chat/completions', chatAuth: 'test-key' },
    });

    const [outcome] = await runner.scan([scanInput]);

    expect(called).toBe(false);
    expect(outcome).toEqual({ ok: false, eventId, reason: 'unavailable' });
  });

  it('calls ChatGPT from CHAT_PROVIDER and OPENAI_API_KEY', async () => {
    const store = createMemoryIngestStore();
    const previous = {
      provider: process.env.CHAT_PROVIDER,
      key: process.env.OPENAI_API_KEY,
      url: process.env.CHAT_URL,
      auth: process.env.CHAT_AUTH,
      model: process.env.OPENAI_MODEL,
    };
    process.env.CHAT_PROVIDER = 'chatgpt';
    process.env.OPENAI_API_KEY = 'openai-test-key';
    delete process.env.CHAT_URL;
    delete process.env.CHAT_AUTH;
    delete process.env.OPENAI_MODEL;
    let seen: { url: string; authorization: string | null; model: string } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      seen = { url: String(url), authorization: new Headers(init?.headers).get('authorization'), model: body.model };
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ contentVerdict: 'safe', summary: 'Musik', language: 'sv', possibleTags: [] }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    try {
      const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });
      const [outcome] = await runner.scan([scanInput]);
      expect(seen?.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(seen?.authorization).toBe('Bearer openai-test-key');
      expect(seen?.model).toBe('gpt-4.1-mini');
      expect(outcome).toMatchObject({ ok: true, summary: 'Musik' });
    } finally {
      restoreEnv('CHAT_PROVIDER', previous.provider);
      restoreEnv('OPENAI_API_KEY', previous.key);
      restoreEnv('CHAT_URL', previous.url);
      restoreEnv('CHAT_AUTH', previous.auth);
      restoreEnv('OPENAI_MODEL', previous.model);
    }
  });

  it('calls Claude from CHAT_PROVIDER and ANTHROPIC_API_KEY', async () => {
    const store = createMemoryIngestStore();
    const previous = {
      provider: process.env.CHAT_PROVIDER,
      key: process.env.ANTHROPIC_API_KEY,
      url: process.env.CHAT_URL,
      auth: process.env.CHAT_AUTH,
      model: process.env.ANTHROPIC_MODEL,
    };
    process.env.CHAT_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    delete process.env.CHAT_URL;
    delete process.env.CHAT_AUTH;
    delete process.env.ANTHROPIC_MODEL;
    let seen: { url: string; apiKey: string | null; model: string } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      seen = { url: String(url), apiKey: new Headers(init?.headers).get('x-api-key'), model: body.model };
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ contentVerdict: 'safe', summary: 'Musik', language: 'en', possibleTags: [] }),
            },
          ],
        }),
        { status: 200 },
      );
    };
    try {
      const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });
      const [outcome] = await runner.scan([scanInput]);
      expect(seen?.url).toBe('https://api.anthropic.com/v1/messages');
      expect(seen?.apiKey).toBe('anthropic-test-key');
      expect(seen?.model).toBe('claude-sonnet-5-5');
      expect(outcome).toMatchObject({ ok: true, language: 'en' });
    } finally {
      restoreEnv('CHAT_PROVIDER', previous.provider);
      restoreEnv('ANTHROPIC_API_KEY', previous.key);
      restoreEnv('CHAT_URL', previous.url);
      restoreEnv('CHAT_AUTH', previous.auth);
      restoreEnv('ANTHROPIC_MODEL', previous.model);
    }
  });

  it('does not call Ollama when chatgpt is selected and the OpenAI key is missing', async () => {
    const store = createMemoryIngestStore();
    const previous = {
      key: process.env.OPENAI_API_KEY,
      auth: process.env.CHAT_AUTH,
      url: process.env.CHAT_URL,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.CHAT_AUTH;
    delete process.env.CHAT_URL;
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };
    try {
      const runner = createOllamaWithToolsPromptRunner(store, {
        fetch: fetchImpl,
        config: { chatProvider: 'chatgpt' },
      });
      const [outcome] = await runner.scan([scanInput]);
      expect(called).toBe(false);
      expect(outcome).toEqual({ ok: false, eventId, reason: 'unavailable' });
    } finally {
      restoreEnv('OPENAI_API_KEY', previous.key);
      restoreEnv('CHAT_AUTH', previous.auth);
      restoreEnv('CHAT_URL', previous.url);
    }
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
