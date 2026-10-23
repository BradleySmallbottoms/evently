import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';

import { createOtaUpdateSession, startOtaUpdateChecks } from './ota-updates';

/**
 * Release builds check EAS Update on launch, then again while the process
 * stays alive. Development and Expo Go leave `Updates.isEnabled` false.
 */
export function installOtaUpdateChecks(): () => void {
  if (Platform.OS === 'web' || !Updates.isEnabled) return () => {};
  const session = createOtaUpdateSession({
    enabled: true,
    check: () => Updates.checkForUpdateAsync(),
    fetch: () => Updates.fetchUpdateAsync(),
    reload: () => Updates.reloadAsync(),
  });
  return startOtaUpdateChecks(session, AppState);
}
