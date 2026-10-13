import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAppQueryClient,
  EVENT_LIST_STALE_MS,
  eventListFreshness,
  focusManager,
  QueryObserver,
  subscribeQueryFocus,
} from '../../../apps/mobile/src/lib/query-client';

function fakeAppState() {
  const listeners = new Set<(status: string) => void>();
  return {
    listenerCount: () => listeners.size,
    emit(status: string) {
      for (const listener of listeners) listener(status);
    },
    addEventListener(_type: 'change', listener: (status: string) => void) {
      listeners.add(listener);
      return {
        remove() {
          listeners.delete(listener);
        },
      };
    },
  };
}

async function waitForFetches(read: () => number, expected: number) {
  await vi.waitFor(() => {
    expect(read()).toBe(expected);
  });
}

/** Give a focus event time to start a refetch before asserting it did not. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('event list foreground refresh', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
    focusManager.setFocused(undefined);
    vi.restoreAllMocks();
  });

  it('refetches a stale event query when the app becomes active again', async () => {
    const now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const appState = fakeAppState();
    const stop = subscribeQueryFocus(appState, 'ios');
    const client = createAppQueryClient();
    client.mount();
    let fetches = 0;
    const observer = new QueryObserver(client, {
      queryKey: ['public-events'],
      queryFn: async () => {
        fetches += 1;
        return fetches;
      },
      ...eventListFreshness,
    });
    const unsubscribe = observer.subscribe(() => {});
    cleanups.push(() => {
      unsubscribe();
      client.unmount();
      client.clear();
      stop();
    });
    await waitForFetches(() => fetches, 1);

    clock.mockReturnValue(now + EVENT_LIST_STALE_MS - 1);
    appState.emit('background');
    appState.emit('active');
    await settle();
    expect(fetches).toBe(1);

    clock.mockReturnValue(now + EVENT_LIST_STALE_MS);
    appState.emit('background');
    appState.emit('active');
    await waitForFetches(() => fetches, 2);
  });

  it('leaves queries that did not opt in alone on foreground', async () => {
    const appState = fakeAppState();
    const stop = subscribeQueryFocus(appState, 'ios');
    const client = createAppQueryClient();
    client.mount();
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);

    let fetches = 0;
    const observer = new QueryObserver(client, {
      queryKey: ['identity'],
      queryFn: async () => {
        fetches += 1;
        return fetches;
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    cleanups.push(() => {
      unsubscribe();
      client.unmount();
      client.clear();
      stop();
    });
    await waitForFetches(() => fetches, 1);

    appState.emit('background');
    appState.emit('active');
    await settle();
    expect(fetches).toBe(1);
  });

  it('keeps the browser focus listener on web', () => {
    const appState = fakeAppState();
    const stop = subscribeQueryFocus(appState, 'web');
    expect(appState.listenerCount()).toBe(0);
    stop();
  });
});
