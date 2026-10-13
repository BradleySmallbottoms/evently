import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { radius, space } from '@/theme/tokens';

function areaDetail(
  area: { kind: string; radiusM: number | null; polygon: unknown[] | null },
  t: (key: string, options?: Record<string, string>) => string,
): string {
  if (area.radiusM != null) {
    const radiusLabel =
      area.radiusM >= 1000
        ? `${Number((area.radiusM / 1000).toFixed(1))} km`
        : `${area.radiusM} m`;
    return t('profile.areaRadius', { radius: radiusLabel });
  }
  if (area.kind === 'region') return t('profile.areaRegion');
  if (area.polygon && area.polygon.length > 0) return t('profile.areaDrawn');
  return t('profile.areaRegion');
}

export default function SavedAreasScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

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
    mutationFn: async (areaId: string) => {
      const id = identity.data;
      if (!id) throw new Error('missing_identity');
      await deleteArea(id, areaId);
      return areaId;
    },
    onSuccess: async (areaId) => {
      if (getDiscoveryPlaceId() === areaId) setDiscoveryPlaceId(NEARBY_PLACE_ID);
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });

  function confirmDelete(area: { id: string; name: string }) {
    Alert.alert(t('profile.areaDeleteTitle'), t('profile.areaDeleteMessage', { name: area.name }), [
      { text: t('preferences.resetCancel'), style: 'cancel' },
      {
        text: t('profile.areaDelete'),
        style: 'destructive',
        onPress: () => {
          remove.mutate(area.id);
        },
      },
    ]);
  }

  const areas = preferences.data?.areas ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md }}>
        <BackPill />
      </View>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.xl, gap: space.xl, paddingBottom: space.xxxl }}
      >
        {identity.isError || preferences.isError ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {t('profile.areasLoadError')}
          </AppText>
        ) : null}
        {remove.isError ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {t('profile.areaDeleteError')}
          </AppText>
        ) : null}
        {preferences.isSuccess && areas.length === 0 ? (
          <View style={{ gap: space.sm }}>
            <AppText variant="subtitle">{t('profile.areasEmptyTitle')}</AppText>
            <AppText variant="caption">{t('profile.areasEmptyBody')}</AppText>
          </View>
        ) : null}
        {areas.length > 0 ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.line,
              overflow: 'hidden',
            }}
          >
            {areas.map((area, index) => (
              <View
                key={area.id}
                style={{
                  minHeight: 64,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  borderBottomWidth: index === areas.length - 1 ? 0 : 1,
                  borderBottomColor: colors.line,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="body">{area.name}</AppText>
                  <AppText variant="caption">{areaDetail(area, t)}</AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.areaDelete')}
                  disabled={remove.isPending}
                  onPress={() => confirmDelete(area)}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm }}
                >
                  <AppText variant="label" style={{ color: colors.danger }}>
                    {t('profile.areaDelete')}
                  </AppText>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
