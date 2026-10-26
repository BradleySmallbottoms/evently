import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';

import { createOtaUpdateSession, startOtaUpdateChecks } from './ota-updates';

const readyListeners = new Set<() => void>();
let updateReady = false;

/** True after this process has downloaded a bundle that is not running yet. */
export function otaUpdateIsReady(): boolean {
  return updateReady;
}

export function subscribeOtaUpdateReady(listener: () => void): () => void {
  readyListeners.add(listener);
  if (updateReady) listener();
  return () => {
    readyListeners.delete(listener);
  };
}

export function reloadOtaUpdate(): Promise<void> {
  if (Platform.OS === 'web' || !Updates.isEnabled) return Promise.resolve();
  return Updates.reloadAsync();
}

function notifyOtaUpdateReady() {
  updateReady = true;
  for (const listener of readyListeners) listener();
}

/**
 * Release builds check EAS Update on launch, then again while the process
 * stays alive. A downloaded bundle notifies subscribers. Development and Expo
 * Go leave `Updates.isEnabled` false.
 */
export function installOtaUpdateChecks(): () => void {
  if (Platform.OS === 'web' || !Updates.isEnabled) return () => {};
  const session = createOtaUpdateSession(
    {
      enabled: true,
      check: () => Updates.checkForUpdateAsync(),
      fetch: () => Updates.fetchUpdateAsync(),
      reload: () => Updates.reloadAsync(),
    },
    { onReady: notifyOtaUpdateReady },
  );
  return startOtaUpdateChecks(session, AppState);
}
