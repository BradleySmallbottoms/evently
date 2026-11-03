import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { ensureIdentity } from '@/lib/identity';
import { getPreferences, updateQuietHours } from '@/lib/preferences';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const DEFAULT_QUIET_START = 22 * 60;
const DEFAULT_QUIET_END = 8 * 60;

export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
  });

  const quietHours = useMutation({
    mutationFn: async (enabled: boolean) => {
      const id = identity.data;
      if (!id) throw new Error('missing_identity');
      const current = preferences.data?.quietHours;
      await updateQuietHours(id, {
        enabled,
        startMin: current?.startMin ?? DEFAULT_QUIET_START,
        endMin: current?.endMin ?? DEFAULT_QUIET_END,
      });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
    onError: () => setError(t('preferences.saveError')),
  });
  const quietEnabled = quietHours.isPending
    ? quietHours.variables
    : (preferences.data?.quietHours.enabled ?? true);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md }}>
        <BackPill />
      </View>
      <View style={{ paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md }}>
        <AppText variant="subtitle">{t('preferences.quietHoursTitle')}</AppText>
        <AppText variant="caption">{t('preferences.quietHoursHint')}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(
            [
              { on: true, label: t('preferences.quietHoursOn') },
              { on: false, label: t('preferences.quietHoursOff') },
            ] as const
          ).map((opt) => {
            const selected = quietEnabled === opt.on;
            return (
              <Pressable
                key={opt.label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={!identity.data || preferences.isPending || quietHours.isPending}
                onPress={() => quietHours.mutate(opt.on)}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm + 2,
                  borderRadius: radius.pill,
                  borderCurve: 'continuous',
                  backgroundColor: selected ? colors.accent : (colors.card as string),
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.line,
                }}
              >
                <AppText
                  variant="label"
                  style={{ color: selected ? colors.onFill : colors.ink, fontWeight: '600' }}
                >
                  {opt.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        {error ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {error}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
