/** How long the catcher stays after the share sheet has closed. */
export const SHARE_TOUCH_SHIELD_RELEASE_MS = 500;

type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();
let depth = 0;
let generation = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function emit(active: boolean) {
  for (const listener of listeners) listener(active);
}

export function shareTouchShieldActive(): boolean {
  return depth > 0 || releaseTimer !== null;
}

export function subscribeShareTouchShield(listener: Listener): () => void {
  listeners.add(listener);
  listener(shareTouchShieldActive());
  return () => {
    listeners.delete(listener);
  };
}

/** Cover the screen before the system share sheet is shown. */
export function armShareTouchShield(): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  depth += 1;
  generation += 1;
  emit(true);
}

/** Drops the cover immediately. Only tests may call this. */
export function resetShareTouchShield(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetShareTouchShield is only available in tests');
  }
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  depth = 0;
  generation += 1;
  emit(false);
}

/**
 * Keep the cover up briefly after the sheet closes. The tap that dismisses
 * the sheet is delivered to the screen underneath a moment later.
 */
export function releaseShareTouchShield(): void {
  depth = Math.max(0, depth - 1);
  if (depth > 0) return;
  const released = generation;
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (generation !== released || depth > 0) return;
    emit(false);
  }, SHARE_TOUCH_SHIELD_RELEASE_MS);
}
