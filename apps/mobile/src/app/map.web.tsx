import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { listPublicEvents } from '@/lib/events';
import { isWholeDay, shownWhen } from '@/lib/span-occasions';
import { eventListFreshness } from '@/lib/query-client';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

export default function MapWebScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = i18n.language === 'en' ? 'en' : 'sv';

  const { point } = useDiscoveryPoint();
  const events = useQuery({
    queryKey: ['public-events-map', point.data?.lat, point.data?.lng, point.data?.radiusM],
    ...eventListFreshness,
    queryFn: () => listPublicEvents(point.data!),
    enabled: point.isSuccess,
  });
  const failed = point.isError || events.isError;
  const loading = !failed && (point.isLoading || events.isLoading);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <FlatList
        style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        data={events.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: space.xl,
          gap: space.md,
          paddingBottom: BottomTabInset + space.xxxl,
        }}
        ListHeaderComponent={<View style={{ height: 44 + space.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/events/${item.id}`)}
            style={({ pressed }) => ({
              backgroundColor: colors.card as string,
              borderRadius: radius.lg,
              borderCurve: 'continuous',
              padding: space.lg,
              gap: space.xs,
              boxShadow: shadow.soft,
              opacity: pressed ? 0.92 : 1,
              transform: [{ scale: pressed ? 0.99 : 1 }],
            })}
          >
            <AppText variant="subtitle">{item.title}</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <SymbolView name={'calendar' as never} size={14} tintColor={colors.inkFaint} />
              <AppText variant="caption">
                {(() => {
                  const shown = shownWhen(item, new Date());
                  return isWholeDay(shown.startsAt, shown.endsAt)
                    ? t('events.wholeDay')
                    : new Date(shown.startsAt).toLocaleString(locale);
                })()}
              </AppText>
            </View>
          </Pressable>
        )}
      />
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]}>
          <ActivityIndicator accessibilityLabel={t('events.loading')} color={colors.ink} />
        </View>
      ) : null}
      {failed ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { padding: space.xl }]}>
          <AppText variant="body" style={{ color: colors.danger, textAlign: 'center' }}>
            {t('events.loadError')}
          </AppText>
        </View>
      ) : null}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: insets.top + space.sm,
          left: space.lg,
        }}
      >
        <BackPill />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
});
