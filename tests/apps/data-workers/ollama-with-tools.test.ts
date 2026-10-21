import { describe, expect, it, vi } from 'vitest';
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
  pageLinks: [],
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
      id: '33333333-3333-4333-8333-333333333404',
      name: 'Kilometerns förening',
      slug: 'kilometerns-forening',
      isTemporary: false,
      status: 'published',
      importNotificationPlan: null,
      createdAt: 3,
    },
    {
      id: nearPublisherId,
      name: 'Hälsinglands museum',
      slug: 'halsinglands-museum',
      isTemporary: false,
      status: 'published',
      importNotificationPlan: null,
      createdAt: 1,
    },
    {
      id: farPublisherId,
      name: 'Långt bort',
      slug: 'langt-bort',
      isTemporary: true,
      status: 'in_review',
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
      id: '33333333-3333-4333-8333-333333333307',
      publisherId: '33333333-3333-4333-8333-333333333404',
      title: 'En kilometer bort',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://example.com/kilometer',
      startsAt: nearbyStart,
      endsAt: nearbyStart,
      venueName: 'Skolan',
      location: { lat: 61.31, lng: 17.07 },
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
    instructions: [' Ta med matsäck ', ''],
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
    expect(toolMessage?.content).not.toContain('En kilometer bort');
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
      instructions: ['Ta med matsäck'],
    });
  });

  it('reads the scan object when the model wraps it in prose and a markdown fence', async () => {
    const store = storeWithNearbyRows();
    const wrapped = [
      'Based on the information gathered:',
      '',
      '- The event is a night trail run organized by Johannes Tyve.',
      '- Nearby events were checked, but none matched the criteria for a duplicate.',
      '',
      'Possible Tags:',
      '- {"id":"visit-soderhamn:30194","name":"Bandy & Innebandy"}',
      '- {"id":"visit-soderhamn:56387","name":"Höstlov"}',
      '',
      'JSON Response:',
      '```json',
      '{',
      '  "possiblePublishers": [],',
      '  "possibleDuplicates": [],',
      '  "contentVerdict": "safe",',
      '  "summary": "Night Trail Run {kväll} i skogen.",',
      '  "language": "sv",',
      '  "possibleTags": [',
      '    {"id":"visit-soderhamn:30194","score":100},',
      '    {"id":"visit-soderhamn:56387","score":100}',
      '  ]',
      '}',
      '```',
    ].join('\n');
    const { fetchImpl } = scriptedFetch([answer(wrapped)]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(outcome).toMatchObject({
      ok: true,
      contentVerdict: 'safe',
      summary: 'Night Trail Run {kväll} i skogen.',
      language: 'sv',
      tags: [{ externalId: 'visit-soderhamn:30194', name: 'Bandy & Innebandy' }],
      duplicate: null,
      publisher: { kind: 'temporary', name: 'Föreningen' },
    });
  });

  it('reads a scan object that follows other JSON in the reply', async () => {
    const store = storeWithNearbyRows();
    const wrapped =
      'Tags:\n- {"id":"visit-soderhamn:30194","name":"Bandy & Innebandy"}\n' +
      '{"contentVerdict":"harmful","summary":"Musik","language":"en","possibleTags":[{"id":"visit-soderhamn:30194","score":95}]}';
    const { fetchImpl } = scriptedFetch([answer(wrapped)]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(outcome).toMatchObject({
      ok: true,
      contentVerdict: 'harmful',
      summary: 'Musik',
      language: 'en',
      tags: [{ externalId: 'visit-soderhamn:30194', name: 'Bandy & Innebandy' }],
    });
  });

  it('skips a publisher id that is not a uuid', async () => {
    const store = storeWithNearbyRows();
    const lookedUp: string[] = [];
    const guarded = {
      ...store,
      getPublisher: async (publisherId: string) => {
        lookedUp.push(publisherId);
        return store.getPublisher(publisherId);
      },
    };
    const { fetchImpl } = scriptedFetch([
      answer(
        JSON.stringify({
          contentVerdict: 'safe',
          summary: 'Musik i Helsingehus',
          language: 'sv',
          possiblePublishers: [{ publisherId: 'Hälsinglands museum', rank: 1 }],
        }),
      ),
    ]);
    const runner = createOllamaWithToolsPromptRunner(guarded, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(lookedUp).toEqual([]);
    expect(outcome).toMatchObject({
      ok: true,
      publisher: { kind: 'temporary', name: 'Föreningen' },
    });
  });

  it('uses an existing publisher when the model returns its id', async () => {
    const store = storeWithNearbyRows();
    const { fetchImpl } = scriptedFetch([
      answer(
        JSON.stringify({
          contentVerdict: 'safe',
          summary: 'Musik i Helsingehus',
          language: 'sv',
          possiblePublishers: [{ publisherId: nearPublisherId, rank: 1 }],
        }),
      ),
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(outcome).toMatchObject({
      ok: true,
      publisher: { kind: 'existing', publisherId: nearPublisherId, status: 'published' },
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
    expect(toolMessage?.content).not.toContain('Kilometerns förening');
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
      status: 'published',
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

  it('reads a scan object whose strings contain raw newlines', async () => {
    const store = createMemoryIngestStore();
    const reply = answer(
      '{"reasoning_content":"The publisher matched.\n\nTags scored over 90.","contentVerdict":"safe","summary":"Musik i arenan.\n\n1. Kom till arenan.","language":"sv","possibleTags":[{"id":"visit-soderhamn:30194","score":95}],"possiblePublishers":[],"possibleDuplicates":[]}',
    );
    const { fetchImpl } = scriptedFetch([reply]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(outcome).toMatchObject({
      ok: true,
      contentVerdict: 'safe',
      summary: 'Musik i arenan.\n\n1. Kom till arenan.',
      language: 'sv',
      tags: [{ externalId: 'visit-soderhamn:30194', name: 'Bandy & Innebandy' }],
    });
  });

  it('leaves the scan unavailable when the reply is prose without a scan object', async () => {
    const store = createMemoryIngestStore();
    const { fetchImpl } = scriptedFetch([
      answer('The event looks safe. Summary: a concert. No JSON follows.'),
    ]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(outcome).toEqual({ ok: false, eventId, reason: 'unavailable' });
  });

  it('leaves the scan unavailable when the reply JSON is not a scan object', async () => {
    const store = createMemoryIngestStore();
    const { fetchImpl } = scriptedFetch([answer('{"id":"visit-soderhamn:30194","name":"Bandy"}')]);
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    const [outcome] = await runner.scan([scanInput]);

    expect(outcome).toEqual({ ok: false, eventId, reason: 'unavailable' });
  });

  it('logs a chat timeout and leaves the scan unavailable', async () => {
    const store = createMemoryIngestStore();
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args);
    });
    const fetchImpl: typeof fetch = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    try {
      const [outcome] = await runner.scan([scanInput]);

      expect(outcome).toEqual({ ok: false, eventId, reason: 'timeout' });
      expect(logs).toContainEqual(['chat timed out', 'ollama']);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not call a network failure a timeout', async () => {
    const store = createMemoryIngestStore();
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args);
    });
    const fetchImpl: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl });

    try {
      const [outcome] = await runner.scan([scanInput]);

      expect(outcome).toEqual({ ok: false, eventId, reason: 'unavailable' });
      expect(logs.some((line) => line[0] === 'chat timed out')).toBe(false);
    } finally {
      spy.mockRestore();
    }
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
    const { fetchImpl } = scriptedFetch(
      Array.from({ length: 8 }, () => toolCall('getAvailableTags', {})),
    );
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

  it('turns thinking off when the model is Qwen3', async () => {
    const store = createMemoryIngestStore();
    let body: { temperature?: number; top_p?: number; top_k?: number; chat_template_kwargs?: { enable_thinking?: boolean } } = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  contentVerdict: 'safe',
                  summary: 'Musik',
                  language: 'sv',
                  possibleTags: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const runner = createOllamaWithToolsPromptRunner(store, {
      fetch: fetchImpl,
      config: {
        chatUrl: 'https://pod.example/v1/chat/completions',
        chatModel: 'Qwen/Qwen3.5-27B-GPTQ-Int4',
        chatAuth: 'test-key',
      },
    });

    await runner.scan([scanInput]);

    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.8);
    expect(body.top_k).toBe(20);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
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
    expect(seen[0]?.body).not.toHaveProperty('temperature');
    const results = seen[1]?.body.messages.find((message) => message.role === 'user' && Array.isArray(message.content));
    expect(JSON.stringify(results?.content)).toContain('toolu_tags');
    expect(outcome).toMatchObject({ ok: true, language: 'en', summary: 'Musik i Helsingehus' });
  });

  it('sends a Claude tool_result for every tool_use in that turn', async () => {
    const store = createMemoryIngestStore();
    const names = [
      'getAvailableTags',
      'getPossiblePublishers',
      'getNearbyPublishers',
      'getPublishersByName',
      'getNearbyEvents',
    ];
    const replies = [
      {
        content: names.map((name, index) => ({
          type: 'tool_use',
          id: `toolu_${index}`,
          name,
          input: name === 'getPublishersByName' ? { name: 'Föreningen*' } : {},
        })),
      },
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ contentVerdict: 'safe', summary: 'Musik', language: 'sv', possibleTags: [] }),
          },
        ],
      },
    ];
    let followUp = '';
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { role: string; content?: unknown }[] };
      const results = body.messages.find((message) => message.role === 'user' && Array.isArray(message.content));
      if (results) followUp = JSON.stringify(results.content);
      const next = replies.shift();
      return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const runner = createOllamaWithToolsPromptRunner(store, {
      fetch: fetchImpl,
      config: {
        chatUrl: 'https://api.anthropic.com/v1/messages',
        chatModel: 'claude-sonnet-5-5',
        chatAuth: 'test-key',
      },
    });

    await runner.scan([scanInput]);

    for (let index = 0; index < names.length; index++) expect(followUp).toContain(`toolu_${index}`);
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

  it('runs two scans at once when concurrency allows it', async () => {
    const store = createMemoryIngestStore();
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl: typeof fetch = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  contentVerdict: 'safe',
                  summary: 'Musik',
                  language: 'sv',
                  possibleTags: [],
                  possiblePublishers: [],
                  possibleDuplicates: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const runner = createOllamaWithToolsPromptRunner(store, {
      concurrency: 2,
      fetch: fetchImpl,
      config: {
        chatProvider: 'openai',
        chatUrl: 'https://example.com/v1/chat/completions',
        chatModel: 'test',
        chatAuth: 'test-key',
      },
    });

    const outcomes = await runner.scan([
      scanInput,
      { ...scanInput, eventId: nearbyEventId, title: 'Marknad', externalId: 'cbis:2' },
    ]);

    expect(maxInFlight).toBe(2);
    expect(outcomes.map((outcome) => outcome.eventId)).toEqual([eventId, nearbyEventId]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });

  it('looks up a publisher with the web tools and keeps a website from a fetched page', async () => {
    const store = createMemoryIngestStore();
    const chats: { tools?: { function: { name: string } }[]; messages: { role: string; content: string }[] }[] = [];
    let chat = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const href = String(url);
      if (href.includes('api.search.brave.com')) {
        return Response.json({
          web: { results: [{ title: 'Föreningen', url: 'https://foreningen.se/om', description: 'Officiell sida' }] },
        });
      }
      if (href.startsWith('https://foreningen.se')) {
        return new Response('<html><head><title>Föreningen</title></head><body><p>Storgatan 1</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      chats.push(JSON.parse(String(init?.body)));
      chat += 1;
      const message =
        chat === 1
          ? toolCall('searchWeb', { query: 'Föreningen Söderhamn' })
          : chat === 2
            ? toolCall('fetchPage', { url: 'https://foreningen.se/om' })
            : answer(
                JSON.stringify({
                  name: 'Föreningen',
                  website: 'https://www.foreningen.se/om',
                  address: 'Storgatan 1',
                  city: 'Söderhamn',
                  description: null,
                  sources: [{ url: 'https://foreningen.se/om' }],
                }),
              );
      return Response.json({ message });
    };
    const runner = createOllamaWithToolsPromptRunner(store, {
      fetch: fetchImpl,
      resolveHost: async () => ['93.184.216.34'],
      braveApiKey: 'test-key',
    });

    const profile = await runner.lookupPublisher({
      publisherId: nearPublisherId,
      name: 'Föreningen',
      organizerKeys: ['kansli@example.com'],
      title: 'Konsert',
      venue: 'Helsingehus',
      location: { lat: 61.3, lng: 17.07 },
    });

    expect(chats[0]?.tools?.map((tool) => tool.function.name)).toEqual(['searchWeb', 'fetchPage']);
    expect(chats[1]?.messages.some((message) => message.content.includes('Officiell sida'))).toBe(true);
    expect(chats[2]?.messages.some((message) => message.content.includes('Storgatan 1'))).toBe(true);
    expect(profile).toMatchObject({
      ok: true,
      profile: {
        website: 'https://www.foreningen.se/om',
        address: 'Storgatan 1',
        city: 'Söderhamn',
        sources: [{ url: 'https://foreningen.se/om' }],
      },
    });
  });

  it('does not call the model for a publisher lookup when web search is not configured', async () => {
    const store = createMemoryIngestStore();
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response('no');
    };
    const runner = createOllamaWithToolsPromptRunner(store, { fetch: fetchImpl, braveApiKey: '' });

    const profile = await runner.lookupPublisher({
      publisherId: nearPublisherId,
      name: 'Föreningen',
      organizerKeys: ['kansli@example.com'],
      title: 'Konsert',
    });

    expect(profile).toEqual({ ok: false, reason: 'unavailable' });
    expect(called).toBe(false);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
