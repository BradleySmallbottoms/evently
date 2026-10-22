import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { EventImage } from '@/components/ui/event-image';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

export function ParticipateBar({
  title,
  when,
  imageUrl,
  tags,
  joinLabel,
  joined,
  onJoin,
  tickets,
}: {
  title: string;
  when: string;
  imageUrl?: string | null;
  tags?: string[];
  joinLabel: string;
  joined: boolean;
  onJoin: () => void;
  tickets?: {
    url: string;
    label: string | null;
  } | null;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0, //Math.max(insets.bottom, space.md),
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        boxShadow: shadow.hardTop,
        paddingHorizontal: space.lg,
        paddingVertical: space.lg,
        paddingBottom: Math.max(insets.bottom, space.lg),
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.sm,
          overflow: 'hidden',
          backgroundColor: colors.accentSoft,
        }}
      >
        <EventImage imageUrl={imageUrl} tags={tags} />
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <AppText numberOfLines={1} style={{ fontSize: 14, lineHeight: 18, fontWeight: '700' }}>
          {title}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {when}
        </AppText>
      </View>
      <PrimaryButton
        label={joinLabel}
        onPress={onJoin}
        color={joined ? (colors.primary as string) : undefined}
        labelColor={'#FFFFFF'}
        icon={{
          sf: joined ? 'checkmark.circle.fill' : 'checkmark.circle',
          md: joined ? 'check-circle' : 'check-circle-outline',
        }}
        style={{ height: 44, width: '100%', paddingHorizontal: space.md }}
      />
    </View>
  );
}
