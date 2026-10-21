import { describe, expect, it, vi } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import type { RunpodChat } from '../../../apps/data-workers/src/runpod-chat';
import { scanWithChatPod } from '../../../apps/data-workers/src/scan-with-pod';
import type { SourceRecord } from '../../../apps/data-workers/src/store';

const source: SourceRecord = {
  id: '33333333-3333-4333-8333-333333333301',
  slug: 'visit-soderhamn',
  trust: 'auto_publish',
  config: {},
  enabled: true,
};

const event = {
  externalId: 'cbis:1',
  title: 'Konsert',
  description: 'En kväll med musik',
  mode: 'physical' as const,
  startsAt: '2027-06-01T18:00:00.000Z',
  endsAt: '2027-06-01T21:00:00.000Z',
  timezone: 'Europe/Stockholm',
  venueName: 'Helsingehus',
  location: { lat: 61.3, lng: 17.07 },
  sourceUrl: 'https://example.com/konsert',
  organizerKeys: ['kansli@example.com'],
  organizerName: 'Föreningen',
  categoryHints: [],
  tags: [] as { externalId: string; name: string }[],
};

function answer(): Response {
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
}

function chatFake(calls: string[], overrides: Partial<RunpodChat> = {}): RunpodChat {
  return {
    async ensureReady() {
      calls.push('ready');
      return {
        chatUrl: 'https://pod.example/v1/chat/completions',
        model: 'Qwen/Qwen2.5-32B-Instruct-AWQ',
        auth: 'chat-key',
        concurrency: 3,
        podId: 'pod_1',
      };
    },
    async stopIfRunning() {
      calls.push('stop-if-running');
    },
    async stop() {
      calls.push('stop');
    },
    ...overrides,
  };
}

describe('scanWithChatPod', () => {
  it('does nothing when another scan holds the lock', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const summary = await scanWithChatPod({
      store: createMemoryIngestStore(),
      databaseUrl: 'postgres://unused',
      chat: chatFake(calls),
      holdLock: async () => null,
      log: (line) => lines.push(line),
    });
    expect(summary.pod).toBe('busy');
    expect(calls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('stops a leftover pod when the queue is empty', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const summary = await scanWithChatPod({
      store: createMemoryIngestStore(),
      databaseUrl: 'postgres://unused',
      chat: chatFake(calls),
      holdLock: async () => ({ release: async () => {} }),
      log: (line) => lines.push(line),
    });
    expect(summary).toMatchObject({ pod: 'idle', claimed: 0 });
    expect(calls).toEqual(['stop-if-running', 'stop']);
    expect(lines).toEqual([]);
  });

  it('drains batches and does not retry a failed row in the same run', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(
      store,
      source,
      Array.from({ length: 6 }, (_, index) => ({ ...event, externalId: `cbis:${index}` })),
    );
    const calls: string[] = [];
    const lines: string[] = [];
    let first = true;
    const fetchImpl: typeof fetch = async () => {
      if (first) {
        first = false;
        return new Response('nope', { status: 500 });
      }
      return answer();
    };
    const summary = await scanWithChatPod({
      store,
      databaseUrl: 'postgres://unused',
      chat: chatFake(calls),
      fetch: fetchImpl,
      holdLock: async () => ({ release: async () => {} }),
      log: (line) => lines.push(line),
    });

    expect(summary).toMatchObject({ pod: 'ran', claimed: 6, unavailable: 1, review: 5 });
    expect(lines.at(-1)).toBe('scanning 0, done 5, failed 1');
    expect(calls).toEqual(['ready', 'stop']);
    expect(store.events.filter((row) => row.status === 'pending_scan')).toHaveLength(1);
  });

  it('still stops the pod when a scan throws', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const calls: string[] = [];
    await expect(
      scanWithChatPod({
        store,
        databaseUrl: 'postgres://unused',
        chat: chatFake(calls, {
          async ensureReady() {
            calls.push('ready');
            throw new Error('gpu missing');
          },
        }),
        holdLock: async () => ({ release: async () => {} }),
      }),
    ).rejects.toThrow('gpu missing');
    expect(calls).toEqual(['ready', 'stop']);
    expect(store.events[0]?.status).toBe('pending_scan');
  });

  it('prints how many events are scanning, done, and failed every second', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const lines: string[] = [];
    const running = scanWithChatPod({
      store,
      databaseUrl: 'postgres://unused',
      chat: chatFake([]),
      fetch: () => gate,
      holdLock: async () => ({ release: async () => {} }),
      log: (line) => lines.push(line),
      progressIntervalMs: 20,
    });

    await vi.waitFor(() => {
      expect(lines).toContain('scanning 1, done 0, failed 0');
    });
    release(answer());
    await running;

    expect(lines.at(-1)).toBe('scanning 0, done 1, failed 0');
  });
});
