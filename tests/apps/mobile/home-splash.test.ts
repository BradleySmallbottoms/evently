import { describe, expect, it } from 'vitest';

import { isHomeListReady, shouldHoldSplashForHome } from '../../../apps/mobile/src/lib/home-splash';

describe('isHomeListReady', () => {
  it('waits while the place or saved tags are still loading', () => {
    expect(
      isHomeListReady({
        storedTags: 'pending',
        point: 'ready',
        tags: 'ready',
        events: 'ready',
      }),
    ).toBe(false);
    expect(
      isHomeListReady({
        storedTags: 'ready',
        point: 'pending',
        tags: 'pending',
        events: 'pending',
      }),
    ).toBe(false);
  });

  it('reveals when the place or saved tags fail, because the list cannot start', () => {
    expect(
      isHomeListReady({
        storedTags: 'failed',
        point: 'pending',
        tags: 'pending',
        events: 'pending',
      }),
    ).toBe(true);
    expect(
      isHomeListReady({
        storedTags: 'ready',
        point: 'failed',
        tags: 'pending',
        events: 'pending',
      }),
    ).toBe(true);
  });

  it('waits for the event list once the place is known', () => {
    expect(
      isHomeListReady({
        storedTags: 'ready',
        point: 'ready',
        tags: 'pending',
        events: 'pending',
      }),
    ).toBe(false);
    expect(
      isHomeListReady({
        storedTags: 'ready',
        point: 'ready',
        tags: 'failed',
        events: 'pending',
      }),
    ).toBe(false);
    expect(
      isHomeListReady({
        storedTags: 'ready',
        point: 'ready',
        tags: 'ready',
        events: 'pending',
      }),
    ).toBe(false);
  });

  it('is ready when the event list has settled', () => {
    expect(
      isHomeListReady({
        storedTags: 'ready',
        point: 'ready',
        tags: 'ready',
        events: 'ready',
      }),
    ).toBe(true);
    expect(
      isHomeListReady({
        storedTags: 'ready',
        point: 'ready',
        tags: 'ready',
        events: 'failed',
      }),
    ).toBe(true);
    expect(
      isHomeListReady({
        storedTags: 'ready',
        point: 'ready',
        tags: 'failed',
        events: 'ready',
      }),
    ).toBe(true);
  });
});

describe('shouldHoldSplashForHome', () => {
  it('holds while the route is unresolved or the home tab is showing', () => {
    expect(shouldHoldSplashForHome([])).toBe(true);
    expect(shouldHoldSplashForHome(['(tabs)'])).toBe(true);
    expect(shouldHoldSplashForHome(['(tabs)', 'index'])).toBe(true);
  });

  it('lets another route dismiss the cover', () => {
    expect(shouldHoldSplashForHome(['(tabs)', 'search'])).toBe(false);
    expect(shouldHoldSplashForHome(['events', 'abc'])).toBe(false);
  });
});
