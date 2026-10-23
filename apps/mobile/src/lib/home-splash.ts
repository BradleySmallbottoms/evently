import type { QueryClient } from '@tanstack/react-query';

export type LoadPhase = 'pending' | 'ready' | 'failed';

export type ObservedQuerySnapshot = {
  observers: number;
  status: 'pending' | 'success' | 'error';
  fetchStatus: 'idle' | 'fetching' | 'paused';
};

/**
 * The home list can paint. A failed place or saved-tag read cannot start the
 * list, so the screen underneath is already its error state. Tag or event
 * failure still waits until that request settles, because the list is running.
 */
export function isHomeListReady(input: {
  storedTags: LoadPhase;
  point: LoadPhase;
  tags: LoadPhase;
  events: LoadPhase;
}): boolean {
  if (input.storedTags === 'failed' || input.point === 'failed') return true;
  if (input.storedTags === 'pending' || input.point === 'pending') return false;
  if (input.tags === 'pending') return false;
  return input.events !== 'pending';
}

/** The home screen is showing a list that is not mid-fetch. */
export function observedHomeListSettled(queries: readonly ObservedQuerySnapshot[]): boolean {
  const observed = queries.filter((query) => query.observers > 0);
  if (observed.length === 0) return false;
  return observed.every(
    (query) =>
      (query.status === 'success' || query.status === 'error') && query.fetchStatus === 'idle',
  );
}

/** Wait until the mounted home list has finished the fetch started by a new place or tags. */
export async function whenObservedHomeListSettles(
  queryClient: QueryClient,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await new Promise((resolve) => setTimeout(resolve, 48));
  while (Date.now() < deadline) {
    const snapshots = queryClient
      .getQueryCache()
      .findAll({ queryKey: ['public-events'] })
      .map((query) => ({
        observers: query.getObserversCount(),
        status: query.state.status,
        fetchStatus: query.state.fetchStatus,
      }));
    if (observedHomeListSettled(snapshots)) return;
    await new Promise((resolve) => setTimeout(resolve, 32));
  }
}

/** Empty segments are still resolving. Hold the cover until the route is known. */
export function shouldHoldSplashForHome(segments: readonly string[]): boolean {
  if (segments.length === 0) return true;
  return segments[0] === '(tabs)' && (segments.length === 1 || segments[1] === 'index');
}
