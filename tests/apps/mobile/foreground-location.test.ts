import { describe, expect, it, vi } from 'vitest';

import {
  createForegroundLocationSession,
  shouldHoldRegionSuggestion,
  shouldPresentRegionSheet,
  shouldReevaluateRegionSuggestion,
  type ForegroundLocationPort,
} from '../../../apps/mobile/src/lib/foreground-location';

const fallback = { lat: 61.3037, lng: 17.0592 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function port(overrides: Partial<ForegroundLocationPort> = {}): ForegroundLocationPort & {
  currentPosition: ReturnType<typeof vi.fn>;
  watch: ReturnType<typeof vi.fn>;
} {
  const watch = vi.fn(async () => ({ remove: vi.fn() }));
  return {
    permissionGranted: async () => true,
    currentPosition: vi.fn(async () => ({ lat: 61.31, lng: 17.07 })),
    watch,
    ...overrides,
  };
}

describe('createForegroundLocationSession', () => {
  it('reads a fix and subscribes while foregrounded', async () => {
    const location = port();
    const session = createForegroundLocationSession(location, { fallback });

    await session.onForeground();

    expect(session.getSnapshot().fix).toEqual({ lat: 61.31, lng: 17.07, located: true });
    expect(session.getSnapshot().check).toBe(1);
    expect(location.watch).toHaveBeenCalledOnce();
  });

  it('publishes the fallback and does not watch when permission is missing', async () => {
    const location = port({ permissionGranted: async () => false });
    const session = createForegroundLocationSession(location, { fallback });

    await session.onForeground();

    expect(session.getSnapshot().fix).toEqual({ ...fallback, located: false });
    expect(location.currentPosition).not.toHaveBeenCalled();
    expect(location.watch).not.toHaveBeenCalled();
  });

  it('keeps the last fix when a later sample fails, and still watches', async () => {
    const location = port();
    const session = createForegroundLocationSession(location, { fallback });
    await session.onForeground();

    location.currentPosition.mockRejectedValueOnce(new Error('location_timeout'));
    await session.onForeground();

    expect(session.getSnapshot().fix).toEqual({ lat: 61.31, lng: 17.07, located: true });
    expect(session.getSnapshot().check).toBe(1);
    expect(location.watch).toHaveBeenCalledTimes(2);
  });

  it('counts a foreground sample that has not moved, and ignores smaller watch updates', async () => {
    let onUpdate: ((sample: { lat: number; lng: number }) => void) | null = null;
    const location = port({
      watch: vi.fn(async (callback: (sample: { lat: number; lng: number }) => void) => {
        onUpdate = callback;
        return { remove: vi.fn() };
      }),
    });
    const session = createForegroundLocationSession(location, { fallback, minMoveM: 100 });
    await session.onForeground();
    const fix = session.getSnapshot().fix;

    onUpdate?.({ lat: 61.3101, lng: 17.07 });
    expect(session.getSnapshot().fix).toBe(fix);
    expect(session.getSnapshot().check).toBe(1);

    location.currentPosition.mockResolvedValueOnce({ lat: 61.3102, lng: 17.07 });
    await session.onForeground();
    expect(session.getSnapshot().fix).toBe(fix);
    expect(session.getSnapshot().check).toBe(2);
  });

  it('publishes a watch update after a real move and drops it after background', async () => {
    let onUpdate: ((sample: { lat: number; lng: number }) => void) | null = null;
    const remove = vi.fn();
    const location = port({
      watch: vi.fn(async (callback: (sample: { lat: number; lng: number }) => void) => {
        onUpdate = callback;
        return { remove };
      }),
    });
    const session = createForegroundLocationSession(location, { fallback, minMoveM: 100 });
    await session.onForeground();

    onUpdate?.({ lat: 61.32, lng: 17.07 });
    expect(session.getSnapshot().fix).toMatchObject({ lat: 61.32, lng: 17.07, located: true });
    expect(session.getSnapshot().check).toBe(1);

    session.onBackground();
    expect(remove).toHaveBeenCalledOnce();
    onUpdate?.({ lat: 59.33, lng: 18.07 });
    expect(session.getSnapshot().fix).toMatchObject({ lat: 61.32, lng: 17.07 });
  });

  it('discards a sample that finishes after the app backgrounds', async () => {
    const pending = deferred<{ lat: number; lng: number }>();
    const location = port({
      currentPosition: vi.fn(() => pending.promise),
    });
    const session = createForegroundLocationSession(location, { fallback });
    const reading = session.onForeground();
    await vi.waitFor(() => expect(location.currentPosition).toHaveBeenCalled());
    session.onBackground();
    pending.resolve({ lat: 59.33, lng: 18.07 });
    await reading;

    expect(session.getSnapshot().fix).toBeNull();
    expect(location.watch).not.toHaveBeenCalled();
  });
});

describe('shouldReevaluateRegionSuggestion', () => {
  const here = { lat: 61.31, lng: 17.07 };

  it('evaluates the first fix and every later foreground sample', () => {
    expect(shouldReevaluateRegionSuggestion(null, here, false)).toBe(true);
    expect(shouldReevaluateRegionSuggestion(here, here, true)).toBe(true);
  });

  it('waits for about a kilometre of movement while the app stays open', () => {
    expect(shouldReevaluateRegionSuggestion(here, { lat: 61.312, lng: 17.07 }, false)).toBe(false);
    expect(shouldReevaluateRegionSuggestion(here, { lat: 61.33, lng: 17.07 }, false)).toBe(true);
  });
});

describe('shouldPresentRegionSheet', () => {
  it('waits until the splash cover has finished', () => {
    expect(shouldPresentRegionSheet(false, true)).toBe(false);
    expect(shouldPresentRegionSheet(true, true)).toBe(true);
    expect(shouldPresentRegionSheet(true, false)).toBe(false);
  });
});

describe('shouldHoldRegionSuggestion', () => {
  const here = { lat: 61.31, lng: 17.07 };

  it('holds the prompt while onboarding is on screen', () => {
    expect(
      shouldHoldRegionSuggestion({ onboardingVisible: true, anchor: null, location: here }),
    ).toBe(true);
  });

  it('holds the place granted during onboarding until the device moves', () => {
    expect(
      shouldHoldRegionSuggestion({ onboardingVisible: false, anchor: here, location: here }),
    ).toBe(true);
    expect(
      shouldHoldRegionSuggestion({
        onboardingVisible: false,
        anchor: here,
        location: { lat: 61.312, lng: 17.07 },
      }),
    ).toBe(true);
    expect(
      shouldHoldRegionSuggestion({
        onboardingVisible: false,
        anchor: here,
        location: { lat: 61.33, lng: 17.07 },
      }),
    ).toBe(false);
  });

  it('does not hold a later visit once onboarding had no location', () => {
    expect(
      shouldHoldRegionSuggestion({ onboardingVisible: false, anchor: null, location: here }),
    ).toBe(false);
  });
});
