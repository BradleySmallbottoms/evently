import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ensureIdentity } from '@/lib/identity';
import {
  requestLocationPermission,
  requestNotificationPermission,
  setPermissionChoice,
  type OnboardingState,
  type PermissionKind,
} from '@/lib/onboarding';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

type Props = {
  kind: PermissionKind;
  state: OnboardingState;
  onDone: (state: OnboardingState) => void;
};

export function PermissionReminder({ kind, state, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    kind === 'notifications'
      ? t('onboarding.reminderNotificationsTitle')
      : t('onboarding.reminderLocationTitle');
  const body =
    kind === 'notifications'
      ? t('onboarding.reminderNotificationsBody')
      : t('onboarding.reminderLocationBody');

  const activate = async () => {
    setBusy(true);
    try {
      let next = state;
      if (kind === 'notifications') {
        const identity = await ensureIdentity(locale);
        const choice = await requestNotificationPermission(identity);
        next = await setPermissionChoice(next, 'notifications', choice);
      } else {
        const choice = await requestLocationPermission();
        next = await setPermissionChoice(next, 'location', choice);
      }
      onDone(next);
    } catch {
      setError(t('home.identityError'));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      // Keep as skipped so another reminder can fire after the next interval.
      const next = await setPermissionChoice(state, kind, 'skipped');
      onDone(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="fade" transparent visible onRequestClose={() => void skip()}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(20,20,20,0.45)',
          justifyContent: 'flex-end',
          paddingBottom: insets.bottom + space.lg,
          paddingHorizontal: space.lg,
        }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.xl,
            borderCurve: 'continuous',
            padding: space.xxl,
            gap: space.lg,
            boxShadow: shadow.card,
          }}
        >
          <AppText variant="title">{title}</AppText>
          <AppText variant="body" style={{ color: colors.inkMuted }}>
            {body}
          </AppText>
          {error ? (
            <AppText variant="caption" style={{ color: colors.danger }}>
              {error}
            </AppText>
          ) : null}
          <PrimaryButton
            label={t('onboarding.activate')}
            loading={busy}
            onPress={() => void activate()}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void skip()}
            style={({ pressed }) => ({
              alignItems: 'center',
              paddingVertical: space.sm,
              opacity: busy ? 0.4 : pressed ? 0.6 : 1,
            })}
          >
            <AppText variant="caption" style={{ color: colors.inkFaint, fontSize: 14 }}>
              {t('onboarding.skip')}
            </AppText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
