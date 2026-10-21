import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../../../packages/db/src/index';
import { handleDuePushMessages } from '../../../apps/worker/src/notify/handle-due-push';

/** Raw sql`` chunks that are Date objects crash postgres-js at bind time. */
function sqlChunksContainDate(value: unknown, seen = new Set<unknown>()): boolean {
  if (value instanceof Date) return true;
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (!('queryChunks' in value) || !Array.isArray(value.queryChunks)) return false;
  return value.queryChunks.some((chunk) => sqlChunksContainDate(chunk, seen));
}

function thenableEmpty() {
  const chain = {
    then(
      onFulfilled?: ((value: unknown[]) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) {
      return Promise.resolve([]).then(onFulfilled, onRejected);
    },
  };
  const proxy: object = new Proxy(chain, {
    get(target, prop, receiver) {
      if (prop === 'then') return Reflect.get(target, prop, receiver);
      return () => proxy;
    },
  });
  return proxy;
}

describe('handleDuePushMessages', () => {
  it('binds claim timestamps as strings, not Date objects', async () => {
    const executed: unknown[] = [];
    const db = {
      select: () => thenableEmpty(),
      execute: async (query: unknown) => {
        executed.push(query);
        return [];
      },
    } as unknown as Db;

    const now = new Date('2026-10-12T20:19:47.444Z');
    await handleDuePushMessages({
      db,
      expo: { send: async () => [] },
      now: () => now,
    });

    expect(executed.length).toBeGreaterThan(0);
    for (const query of executed) {
      expect(sqlChunksContainDate(query)).toBe(false);
    }
    const claim = executed[0];
    expect(sqlChunksContainDate(claim)).toBe(false);
    expect(JSON.stringify(claim)).toContain(now.toISOString());
    expect(JSON.stringify(claim)).toContain('2026-10-12T20:14:47.444Z');
  });
});

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const originalDryRun = process.env.PUSH_DRY_RUN;

afterEach(() => {
  if (originalDryRun === undefined) delete process.env.PUSH_DRY_RUN;
  else process.env.PUSH_DRY_RUN = originalDryRun;
});

function chain(result: unknown, onCall: (method: string, arg: unknown) => void) {
  const proxy: object = new Proxy(function chainFn() {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(result).then(onFulfilled, onRejected);
      }
      return (arg: unknown) => {
        if (prop === 'values' || prop === 'set') onCall(String(prop), arg);
        return proxy;
      };
    },
  });
  return proxy;
}

/** Broadcast audience of one user, with one Expo token, and no aggregation window. */
function duePushDb(selectResults: unknown[][]) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  let executeCount = 0;
  const queued = [...selectResults];
  const db = {
    select: () => chain(queued.shift() ?? [], () => {}),
    insert: () =>
      chain([], (method, arg) => {
        if (method === 'values') inserts.push(arg);
      }),
    update: () =>
      chain([], (method, arg) => {
        if (method === 'set') updates.push(arg);
      }),
    delete: () => chain([], () => {}),
    execute: async () => {
      executeCount += 1;
      if (executeCount === 1) {
        return [
          {
            id: MESSAGE_ID,
            event_id: null,
            kind: 'broadcast',
            audience: 'everyone',
            audience_tag_id: null,
            title_sv: 'Hej',
            body_sv: 'Ikväll',
            title_en: 'Hi',
            body_en: 'Tonight',
            send_at: null,
          },
        ];
      }
      if (executeCount === 2) return [{ user_id: USER_ID }];
      return [];
    },
  } as unknown as Db;
  return { db, inserts, updates };
}

describe('PUSH_DRY_RUN', () => {
  const deviceRow = {
    userId: USER_ID,
    deviceId: '33333333-3333-4333-8333-333333333333',
    expoPushToken: 'ExponentPushToken[dryruntoken]',
    locale: 'sv',
  };

  it('writes dry_run deliveries and does not call Expo', async () => {
    process.env.PUSH_DRY_RUN = '1';
    const sent: unknown[] = [];
    const { db, inserts, updates } = duePushDb([[], [], [], [], [deviceRow]]);
    const result = await handleDuePushMessages({
      db,
      expo: {
        send: async (messages) => {
          sent.push(messages);
          return [];
        },
      },
      now: () => new Date('2026-10-14T08:00:00.000Z'),
    });

    expect(sent).toEqual([]);
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pushMessageId: MESSAGE_ID,
          userId: USER_ID,
          status: 'dry_run',
        }),
      ]),
    );
    expect(updates.some((u) => typeof u === 'object' && u !== null && 'pushState' in u)).toBe(
      false,
    );
    expect(result.sent).toBe(1);
  });

  it('sends to Expo when dry run is off', async () => {
    delete process.env.PUSH_DRY_RUN;
    const sent: unknown[] = [];
    const { db, inserts } = duePushDb([[], [], [], [], [deviceRow], [{ count: 0 }]]);
    await handleDuePushMessages({
      db,
      expo: {
        send: async (messages) => {
          sent.push(messages);
          return messages.map(() => ({ status: 'ok' as const, id: 'ticket' }));
        },
      },
      now: () => new Date('2026-10-14T08:00:00.000Z'),
    });

    expect(sent).toHaveLength(1);
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pushMessageId: MESSAGE_ID,
          userId: USER_ID,
          status: 'sent',
        }),
      ]),
    );
  });
});
