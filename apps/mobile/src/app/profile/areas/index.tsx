import { areaNotificationsEnabled } from '@local-events/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionList } from '@/components/ui/action-list';
import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { ensureIdentity } from '@/lib/identity';
import { deleteArea, getPreferences } from '@/lib/preferences';
import {
  getDiscoveryPlaceId,
  NEARBY_PLACE_ID,
  setDiscoveryPlaceId,
} from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

function areaDetail(
  area: { searchRadiusM: number | null; notify: boolean; tagIds: readonly string[] },
  t: (key: string, options?: Record<string, string>) => string,
): string {
  const notifications = t(
    areaNotificationsEnabled(area) ? 'profile.areaNotificationsOn' : 'profile.areaNotificationsOff',
  );
  if (area.searchRadiusM == null) return notifications;
  const radiusLabel =
    area.searchRadiusM >= 1000
      ? `${Number((area.searchRadiusM / 1000).toFixed(1))} km`
      : `${area.searchRadiusM} m`;
  return t('profile.areaListDetail', { radius: radiusLabel, notifications });
}

export default function SavedAreasScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
  });
  const remove = useMutation({
    mutationFn: (areaId: string) => deleteArea(identity.data!, areaId),
    onSuccess: async (_data, areaId) => {
      setRemoveError(null);
      if (getDiscoveryPlaceId() === areaId) setDiscoveryPlaceId(NEARBY_PLACE_ID);
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
    onError: () => setRemoveError(t('profile.areaDeleteError')),
  });

  const areas = preferences.data?.areas ?? [];

  function confirmDelete(area: { id: string; name: string }) {
    Alert.alert(t('profile.areaDeleteTitle'), t('profile.areaDeleteMessage', { name: area.name }), [
      { text: t('preferences.resetCancel'), style: 'cancel' },
      {
        text: t('profile.areaDelete'),
        style: 'destructive',
        onPress: () => remove.mutate(area.id),
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md }}>
        <BackPill />
      </View>
      {identity.isError || preferences.isError ? (
        <AppText variant="caption" style={{ color: colors.danger, paddingHorizontal: space.xl }}>
          {t('profile.areasLoadError')}
        </AppText>
      ) : null}
      {removeError ? (
        <AppText variant="caption" style={{ color: colors.danger, paddingHorizontal: space.xl }}>
          {removeError}
        </AppText>
      ) : null}
      {preferences.isSuccess && areas.length === 0 ? (
        <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>
          <AppText variant="subtitle">{t('profile.areasEmptyTitle')}</AppText>
          <AppText variant="caption">{t('profile.areasEmptyBody')}</AppText>
        </View>
      ) : null}
      <ActionList
        editLabel={t('lists.edit')}
        deleteLabel={t('lists.delete')}
        items={areas.map((area) => {
          const open = () => router.push(`/profile/areas/${area.id}`);
          return {
            id: area.id,
            title: area.name,
            subtitle: areaDetail(area, t),
            onPress: open,
            onEdit: open,
            onDelete: () => confirmDelete(area),
          };
        })}
      />
    </View>
  );
}
