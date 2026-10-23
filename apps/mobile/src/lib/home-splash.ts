export type LoadPhase = 'pending' | 'ready' | 'failed';

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

/** Empty segments are still resolving. Hold the cover until the route is known. */
export function shouldHoldSplashForHome(segments: readonly string[]): boolean {
  if (segments.length === 0) return true;
  return segments[0] === '(tabs)' && (segments.length === 1 || segments[1] === 'index');
}
