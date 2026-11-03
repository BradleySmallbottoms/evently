import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { SkeletonBlock } from '@/components/ui/skeleton-block';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

import { DetailCard } from './detail-card';

const HERO_HEIGHT = 300;
/** Matches the participate sheet handle. */
const BAR_HANDLE = 20;
/** Matches the collapsed participate bar, excluding the home inset. */
const BAR_BODY = 68;

export function EventDetailHeroSkeleton() {
  return <SkeletonBlock width="100%" height={HERO_HEIGHT} radius={0} color={colors.accentSoft} />;
}

/** Stand-in for the event page while the event itself is still loading. */
export function EventDetailSkeleton() {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('events.loading')}
      accessibilityState={{ busy: true }}
      style={{ gap: space.lg }}
    >
      <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <SkeletonBlock width={88} height={28} />
          <SkeletonBlock width={72} height={28} />
        </View>
        <View style={{ gap: space.sm }}>
          <SkeletonBlock width="92%" height={28} radius={radius.xs} />
          <SkeletonBlock width="64%" height={28} radius={radius.xs} />
          <SkeletonBlock width="80%" height={16} radius={radius.xs} />
        </View>
        <DetailCard>
          <View style={{ gap: space.lg }}>
            <FactRowSkeleton />
            <FactRowSkeleton />
          </View>
        </DetailCard>
      </View>
      <View
        style={{
          paddingHorizontal: space.lg,
          gap: space.lg,
          backgroundColor: colors.cardDarkest,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
        }}
      >
        <View style={{ gap: space.sm }}>
          <SkeletonBlock width={120} height={22} radius={radius.xs} />
          <SkeletonBlock width="100%" height={14} radius={radius.xs} />
          <SkeletonBlock width="100%" height={14} radius={radius.xs} />
          <SkeletonBlock width="94%" height={14} radius={radius.xs} />
          <SkeletonBlock width="68%" height={14} radius={radius.xs} />
        </View>
        <SkeletonBlock width="100%" height={180} radius={radius.lg} />
        <DetailCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <SkeletonBlock width={52} height={52} radius={radius.md} />
            <View style={{ flex: 1 }}>
              <SkeletonBlock width="56%" height={16} radius={radius.xs} />
            </View>
            <SkeletonBlock width={64} height={16} radius={radius.xs} />
          </View>
        </DetailCard>
      </View>
    </View>
  );
}

/** Collapsed participate bar, shown until the event (and its actions) arrive. */
export function EventDetailBarSkeleton({ bottomInset }: { bottomInset: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2,
        backgroundColor: colors.card,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        boxShadow: shadow.hardTop,
        paddingBottom: bottomInset,
      }}
    >
      <View style={{ height: BAR_HANDLE, alignItems: 'center', justifyContent: 'center' }}>
        <SkeletonBlock width={36} height={4} />
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          height: BAR_BODY,
          paddingHorizontal: space.lg,
        }}
      >
        <SkeletonBlock width={64} height={64} radius={radius.sm} />
        <View style={{ flex: 1, gap: space.xs }}>
          <SkeletonBlock width="72%" height={14} radius={radius.xs} />
          <SkeletonBlock width="42%" height={12} radius={radius.xs} />
        </View>
        <SkeletonBlock width={108} height={44} radius={radius.xl} />
      </View>
    </View>
  );
}

function FactRowSkeleton() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }}>
      <SkeletonBlock width={32} height={32} radius={radius.sm} />
      <View style={{ flex: 1, gap: space.xs }}>
        <SkeletonBlock width="48%" height={16} radius={radius.xs} />
        <SkeletonBlock width="32%" height={12} radius={radius.xs} />
      </View>
    </View>
  );
}
