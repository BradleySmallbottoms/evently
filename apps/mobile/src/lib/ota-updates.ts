import type { AppStateStatus } from 'react-native';

/** How often a running release build asks EAS Update for a new bundle. */
export const OTA_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export type OtaUpdateCheck = {
  isAvailable: boolean;
  isRollBackToEmbedded: boolean;
};

export type OtaUpdateFetch = {
  isNew: boolean;
  isRollBackToEmbedded: boolean;
};

export type OtaUpdatesPort = {
  enabled: boolean;
  check: () => Promise<OtaUpdateCheck>;
  fetch: () => Promise<OtaUpdateFetch>;
  reload: () => Promise<void>;
};

export type OtaCheckOutcome = 'skipped' | 'current' | 'reloaded' | 'failed';

export type OtaAppState = {
  currentState: AppStateStatus;
  addEventListener: (
    type: 'change',
    listener: (status: AppStateStatus) => void,
  ) => { remove: () => void };
};

/**
 * The native module already checks when the process starts. This session asks
 * again while that process stays alive, and reloads when a different bundle
 * has been downloaded so the user does not have to kill the app.
 */
export function createOtaUpdateSession(
  port: OtaUpdatesPort,
  options?: { intervalMs?: number; now?: () => number },
) {
  const intervalMs = options?.intervalMs ?? OTA_CHECK_INTERVAL_MS;
  const now = options?.now ?? (() => Date.now());
  let lastCheckedAt: number | null = null;
  let inFlight: Promise<OtaCheckOutcome> | null = null;

  /** Count the native launch check so the first JS check waits a full interval. */
  function noteLaunchCheck(at = now()) {
    if (lastCheckedAt == null) lastCheckedAt = at;
  }

  function millisecondsUntilDue(at = now()) {
    if (lastCheckedAt == null) return intervalMs;
    return Math.max(0, lastCheckedAt + intervalMs - at);
  }

  function checkIfDue(): Promise<OtaCheckOutcome> {
    if (!port.enabled) return Promise.resolve('skipped');
    if (inFlight) return inFlight;
    const at = now();
    if (lastCheckedAt == null) lastCheckedAt = at;
    if (at - lastCheckedAt < intervalMs) return Promise.resolve('skipped');

    // Stamp before the request. A failure still waits out the interval so a
    // flaky network does not hit the update server on every foreground.
    lastCheckedAt = at;
    inFlight = (async (): Promise<OtaCheckOutcome> => {
      try {
        const update = await port.check();
        if (!update.isAvailable && !update.isRollBackToEmbedded) return 'current';
        const fetched = await port.fetch();
        if (!fetched.isNew && !fetched.isRollBackToEmbedded) return 'current';
        await port.reload();
        return 'reloaded';
      } catch {
        return 'failed';
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { noteLaunchCheck, millisecondsUntilDue, checkIfDue };
}

/**
 * While the app is active, check at least once per interval. A resume after
 * the interval has already elapsed checks immediately. A backgrounded process
 * waits until it is active again.
 */
export function startOtaUpdateChecks(
  session: ReturnType<typeof createOtaUpdateSession>,
  appState: OtaAppState,
): () => void {
  session.noteLaunchCheck();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped || appState.currentState !== 'active') return;
      void run();
    }, session.millisecondsUntilDue());
  };

  const run = async () => {
    if (stopped || appState.currentState !== 'active') return;
    await session.checkIfDue();
    if (!stopped && appState.currentState === 'active') arm();
  };

  arm();
  const subscription = appState.addEventListener('change', (status) => {
    if (status !== 'active') return;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    void run();
  });

  return () => {
    stopped = true;
    if (timer != null) clearTimeout(timer);
    subscription.remove();
  };
}
