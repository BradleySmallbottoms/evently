import type { NotificationListResponse } from '@local-events/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InboxTipSheet } from '@/components/native/inbox-tip-sheet';
import { ActionList } from '@/components/ui/action-list';
import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { ensureIdentity } from '@/lib/identity';
import { markNotificationsSeen } from '@/lib/notification-badge';
import { deleteNotification, listNotifications } from '@/lib/notifications';
import { openInboxItem, type InboxTipTarget } from '@/lib/open-inbox-item';
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
  const [inboxTip, setInboxTip] = useState<InboxTipTarget | null>(null);
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
  const [removeError, setRemoveError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (notificationId: string) => deleteNotification(identity.data!, notificationId),
    onMutate: (notificationId) => {
      const key = ['notifications', identity.data?.userId] as const;
      queryClient.setQueryData<NotificationListResponse>(key, (current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== notificationId),
              unreadCount: current.items.some(
                (item) => item.id === notificationId && item.readAt == null,
              )
                ? Math.max(0, current.unreadCount - 1)
                : current.unreadCount,
            }
          : current,
      );
    },
    onError: () => {
      setRemoveError(t('events.notificationDeleteError'));
      void queryClient.invalidateQueries({ queryKey: ['notifications', identity.data?.userId] });
    },
    onSuccess: () => {
      setRemoveError(null);
      void queryClient.invalidateQueries({ queryKey: ['notifications', identity.data?.userId] });
    },
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
        {removeError ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {removeError}
          </AppText>
        ) : null}
      </View>
      {inbox.isPending ? (
        <AppText variant="caption" style={{ paddingHorizontal: space.xl }}>
          {t('events.notificationsLoading')}
        </AppText>
      ) : items.length === 0 ? (
        <View style={{ paddingHorizontal: space.xl }}>
          <EmptyState title={t('events.notifications')} body={t('events.notificationsEmpty')} />
        </View>
      ) : (
        <ActionList
          editLabel={t('lists.edit')}
          deleteLabel={t('lists.delete')}
          items={items.map((item) => {
            const reason =
              item.reason === 'publisher'
                ? t('events.notificationReasonPublisher')
                : item.reason === 'event'
                  ? t('events.notificationReasonEvent')
                  : item.reason === 'broadcast'
                    ? t('events.notificationReasonBroadcast')
                    : item.reason === 'tip'
                      ? t('events.notificationReasonTip')
                      : t('events.notificationReasonNearby');
            return {
              id: item.id,
              title: item.eventTitle,
              subtitle: reason,
              onPress:
                item.eventId || item.reason === 'tip'
                  ? () => {
                      void openInboxItem(router, locale, item, setInboxTip);
                    }
                  : undefined,
              onDelete: () => remove.mutate(item.id),
            };
          })}
        />
      )}
      <InboxTipSheet target={inboxTip} onDismiss={() => setInboxTip(null)} />
    </View>
  );
}
