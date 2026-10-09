import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { MaxContentWidth } from '@/constants/theme';
import { listPublicEvents, resolveEventQueryPoint } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export default function MapWebScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = i18n.language === 'en' ? 'en' : 'sv';

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });
  const point = useQuery({
    queryKey: ['event-query-point-map'],
    queryFn: resolveEventQueryPoint,
    enabled: identity.isSuccess,
    retry: false,
  });
  const events = useQuery({
    queryKey: ['public-events-map', point.data?.lat, point.data?.lng, point.data?.radiusM],
    queryFn: () => listPublicEvents(point.data!),
    enabled: point.isSuccess,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <FlatList
        style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        data={events.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: space.xl, gap: space.md }}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.md }}>
            <AppText variant="hero">{t('events.mapTitle')}</AppText>
            <AppText variant="caption">{t('events.mapWebFallback')}</AppText>
            {(point.isLoading || events.isLoading) && (
              <AppText variant="caption">{t('events.loading')}</AppText>
            )}
            {events.isError && (
              <AppText variant="caption" style={{ color: colors.danger }}>
                {t('events.loadError')}
              </AppText>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/events/${item.id}`)}
            style={{
              backgroundColor: colors.card as string,
              borderRadius: radius.md,
              borderCurve: 'continuous',
              padding: space.lg,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <AppText variant="subtitle">{item.title}</AppText>
            <AppText variant="caption">
              {new Date(item.startsAt).toLocaleString(locale)}
            </AppText>
          </Pressable>
        )}
      />
    </View>
  );
}
