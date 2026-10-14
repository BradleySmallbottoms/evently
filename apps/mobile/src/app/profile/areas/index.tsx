import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { ensureIdentity } from '@/lib/identity';
import { getPreferences } from '@/lib/preferences';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

function areaDetail(
  area: { searchRadiusM: number | null; notify: boolean },
  t: (key: string, options?: Record<string, string>) => string,
): string {
  const notifications = t(area.notify ? 'profile.areaNotificationsOn' : 'profile.areaNotificationsOff');
  if (area.searchRadiusM == null) return notifications;
  const radiusLabel =
    area.searchRadiusM >= 1000
      ? `${Number((area.searchRadiusM / 1000).toFixed(1))} km`
      : `${area.searchRadiusM} m`;
  return t('profile.areaListDetail', { radius: radiusLabel, notifications });
}

function Chevron() {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={'chevron.right' as never} size={14} tintColor={colors.inkFaint} />;
  }
  return <MaterialIcons name="chevron-right" size={20} color={colors.inkFaint} />;
}

export default function SavedAreasScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
  });

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
              <Pressable
                key={area.id}
                accessibilityRole="button"
                accessibilityLabel={t('profile.areaEditA11y', { name: area.name })}
                onPress={() => router.push(`/profile/areas/${area.id}`)}
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
                <Chevron />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
