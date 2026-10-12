import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { ensureIdentity } from '@/lib/identity';
import { markNotificationsSeen } from '@/lib/notification-badge';
import { listNotifications } from '@/lib/notifications';
import { getPreferences, updateQuietHours } from '@/lib/preferences';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const DEFAULT_QUIET_START = 22 * 60;
const DEFAULT_QUIET_END = 8 * 60;

export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
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
  const inbox = useQuery({
    queryKey: ['notifications', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listNotifications(identity.data!),
  });
  const items = inbox.data?.items ?? [];
  const unreadCount = inbox.data?.unreadCount;

  useEffect(() => {
    if (unreadCount == null) return;
    let cancelled = false;
    void markNotificationsSeen(unreadCount).then(() => {
      if (!cancelled) void queryClient.invalidateQueries({ queryKey: ['notifications-seen'] });
    });
    return () => {
      cancelled = true;
    };
  }, [unreadCount, queryClient]);
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
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={{ paddingHorizontal: space.xl, paddingVertical: space.md }}
      >
        <AppText variant="label" style={{ color: colors.accent }}>
          {t('preferences.back')}
        </AppText>
      </Pressable>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: space.xl,
          paddingBottom: space.xxxl,
          gap: space.lg,
        }}
      >
        <AppText variant="title">{t('events.notifications')}</AppText>
        <View style={{ gap: space.md }}>
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
                  <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
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
        {inbox.isPending ? (
          <AppText variant="caption">{t('events.notificationsLoading')}</AppText>
        ) : items.length === 0 ? (
          <EmptyState title={t('events.notifications')} body={t('events.notificationsEmpty')} />
        ) : (
          <View style={{ gap: space.sm }}>
            {items.map((item) => {
              const reason =
                item.reason === 'publisher'
                  ? t('events.notificationReasonPublisher')
                  : item.reason === 'event'
                    ? t('events.notificationReasonEvent')
                    : t('events.notificationReasonNearby');
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/events/${item.eventId}`)}
                  style={{
                    backgroundColor: colors.card as string,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: colors.line,
                    padding: space.lg,
                    gap: space.xs,
                  }}
                >
                  <AppText variant="subtitle">{item.eventTitle}</AppText>
                  <AppText variant="caption">{reason}</AppText>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
