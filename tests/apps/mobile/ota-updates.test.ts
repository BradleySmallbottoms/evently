import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppStateStatus } from 'react-native';

import {
  createOtaUpdateSession,
  OTA_CHECK_INTERVAL_MS,
  startOtaUpdateChecks,
  type OtaAppState,
  type OtaUpdatesPort,
} from '../../../apps/mobile/src/lib/ota-updates';

const HOUR = 60 * 60 * 1000;

function port(overrides: Partial<OtaUpdatesPort> = {}): OtaUpdatesPort & {
  check: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
} {
  return {
    enabled: true,
    check: vi.fn(async () => ({ isAvailable: false, isRollBackToEmbedded: false })),
    fetch: vi.fn(async () => ({ isNew: false, isRollBackToEmbedded: false })),
    reload: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeAppState(initial: AppStateStatus = 'active'): OtaAppState & {
  emit: (status: AppStateStatus) => void;
} {
  let currentState = initial;
  const listeners = new Set<(status: AppStateStatus) => void>();
  return {
    get currentState() {
      return currentState;
    },
    emit(status) {
      currentState = status;
      for (const listener of listeners) listener(status);
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
  };
}

describe('createOtaUpdateSession', () => {
  it('waits out the interval after the launch check', async () => {
    let now = 1_000;
    const updates = port();
    const session = createOtaUpdateSession(updates, { intervalMs: HOUR, now: () => now });
    session.noteLaunchCheck();

    now = 1_000 + HOUR - 1;
    await expect(session.checkIfDue()).resolves.toBe('skipped');
    expect(updates.check).not.toHaveBeenCalled();

    now = 1_000 + HOUR;
    await expect(session.checkIfDue()).resolves.toBe('current');
    expect(updates.check).toHaveBeenCalledOnce();
    expect(updates.fetch).not.toHaveBeenCalled();
  });

  it('downloads a new bundle and leaves the reload to the user', async () => {
    let now = 0;
    const onReady = vi.fn();
    const updates = port({
      check: vi.fn(async () => ({ isAvailable: true, isRollBackToEmbedded: false })),
      fetch: vi.fn(async () => ({ isNew: true, isRollBackToEmbedded: false })),
    });
    const session = createOtaUpdateSession(updates, {
      intervalMs: HOUR,
      now: () => now,
      onReady,
    });
    session.noteLaunchCheck();
    now = HOUR;

    await expect(session.checkIfDue()).resolves.toBe('ready');
    expect(updates.fetch).toHaveBeenCalledOnce();
    expect(updates.reload).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('downloads a rollback and leaves the reload to the user', async () => {
    let now = 0;
    const onReady = vi.fn();
    const updates = port({
      check: vi.fn(async () => ({ isAvailable: false, isRollBackToEmbedded: true })),
      fetch: vi.fn(async () => ({ isNew: false, isRollBackToEmbedded: true })),
    });
    const session = createOtaUpdateSession(updates, {
      intervalMs: HOUR,
      now: () => now,
      onReady,
    });
    session.noteLaunchCheck();
    now = HOUR;

    await expect(session.checkIfDue()).resolves.toBe('ready');
    expect(updates.reload).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('leaves the running bundle when the download is not new', async () => {
    let now = 0;
    const updates = port({
      check: vi.fn(async () => ({ isAvailable: true, isRollBackToEmbedded: false })),
      fetch: vi.fn(async () => ({ isNew: false, isRollBackToEmbedded: false })),
    });
    const session = createOtaUpdateSession(updates, { intervalMs: HOUR, now: () => now });
    session.noteLaunchCheck();
    now = HOUR;

    await expect(session.checkIfDue()).resolves.toBe('current');
    expect(updates.reload).not.toHaveBeenCalled();
  });

  it('waits a full interval after a failed check', async () => {
    let now = 0;
    const updates = port({
      check: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const session = createOtaUpdateSession(updates, { intervalMs: HOUR, now: () => now });
    session.noteLaunchCheck();
    now = HOUR;

    await expect(session.checkIfDue()).resolves.toBe('failed');
    now = HOUR + HOUR - 1;
    await expect(session.checkIfDue()).resolves.toBe('skipped');
    expect(updates.check).toHaveBeenCalledOnce();

    now = HOUR + HOUR;
    await expect(session.checkIfDue()).resolves.toBe('failed');
    expect(updates.check).toHaveBeenCalledTimes(2);
  });

  it('shares one request when two checks overlap', async () => {
    let now = 0;
    let release: (value: {
      isAvailable: boolean;
      isRollBackToEmbedded: boolean;
    }) => void = () => {};
    const updates = port({
      check: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    });
    const session = createOtaUpdateSession(updates, { intervalMs: HOUR, now: () => now });
    session.noteLaunchCheck();
    now = HOUR;

    const first = session.checkIfDue();
    const second = session.checkIfDue();
    release({ isAvailable: false, isRollBackToEmbedded: false });
    await expect(Promise.all([first, second])).resolves.toEqual(['current', 'current']);
    expect(updates.check).toHaveBeenCalledOnce();
  });

  it('does nothing when updates are disabled', async () => {
    let now = 0;
    const updates = port({ enabled: false });
    const session = createOtaUpdateSession(updates, { intervalMs: HOUR, now: () => now });
    session.noteLaunchCheck();
    now = HOUR * 5;

    await expect(session.checkIfDue()).resolves.toBe('skipped');
    expect(updates.check).not.toHaveBeenCalled();
  });
});

describe('startOtaUpdateChecks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks once an hour while the app stays in the foreground', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T09:00:00Z'));
    const updates = port({
      check: vi.fn(async () => ({ isAvailable: true, isRollBackToEmbedded: false })),
      fetch: vi.fn(async () => ({ isNew: true, isRollBackToEmbedded: false })),
    });
    const session = createOtaUpdateSession(updates);
    const stop = startOtaUpdateChecks(session, fakeAppState('active'));

    await vi.advanceTimersByTimeAsync(OTA_CHECK_INTERVAL_MS - 1);
    expect(updates.check).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(updates.check).toHaveBeenCalledOnce();
    expect(updates.reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(OTA_CHECK_INTERVAL_MS);
    expect(updates.check).toHaveBeenCalledTimes(2);

    stop();
  });

  it('checks on the next foreground once an hour has passed, and not before', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T09:00:00Z'));
    const updates = port();
    const session = createOtaUpdateSession(updates);
    const appState = fakeAppState('active');
    const stop = startOtaUpdateChecks(session, appState);

    appState.emit('background');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    appState.emit('active');
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.check).not.toHaveBeenCalled();

    appState.emit('background');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(updates.check).not.toHaveBeenCalled();

    appState.emit('active');
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.check).toHaveBeenCalledOnce();

    stop();
  });
});
