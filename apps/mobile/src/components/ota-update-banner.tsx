import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { useSplashDismissed } from '@/components/splash-cover';
import { reloadOtaUpdate, subscribeOtaUpdateReady } from '@/lib/ota-update-check';
import { useOnboardingVisible } from '@/lib/onboarding-visibility';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

/**
 * A downloaded EAS Update stays on disk until the user taps this banner.
 * The launch check reports through `useUpdates`. Later checks report through
 * the hourly session.
 */
export function OtaUpdateBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const splashDone = useSplashDismissed();
  const onboarding = useOnboardingVisible();
  const native = Updates.useUpdates();
  const [ready, setReady] = useState(false);

  useEffect(() => subscribeOtaUpdateReady(() => setReady(true)), []);

  const show =
    Platform.OS !== 'web' && splashDone && !onboarding && (ready || native.isUpdatePending);
  if (!show) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + space.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('app.updateReady')}. ${t('app.updateReadyAction')}`}
        onPress={() => {
          void reloadOtaUpdate();
        }}
        style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
      >
        <AppText style={styles.title}>{t('app.updateReady')}</AppText>
        <AppText style={styles.action}>{t('app.updateReadyAction')}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    zIndex: 20,
    alignItems: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    boxShadow: shadow.hard,
  },
  pressed: {
    opacity: 0.85,
  },
  title: {
    color: colors.card,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  action: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
