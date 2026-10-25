import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { EventImage } from '@/components/ui/event-image';
import { SponsoredPill } from '@/components/ui/sponsored-event-card';
import { TagPills } from '@/components/ui/tag-pills';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

const THUMB = 72;

type Props = {
  title: string;
  where: string;
  startLabel: string;
  endLabel?: string;
  tags: string[];
  priceLabel?: string | null;
  imageUrl?: string | null;
  /** Shown on the thumbnail when this row is sponsored and has no poster. */
  sponsoredLabel?: string;
  saved?: boolean;
  saveLabel: string;
  onPress: () => void;
  onSavePress?: () => void;
};

function Pin() {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={'mappin' as never} size={12} tintColor={colors.inkMuted} />;
  }
  return <MaterialIcons name="place" size={14} color={colors.inkMuted} />;
}

/** Start, and end when the event has one, over the thumbnail. Whole day is one line. */
function TimePill({ start, end }: { start: string; end?: string }) {
  return (
    <View
      pointerEvents="none"
      style={{
        maxWidth: THUMB - 8,
        backgroundColor: colors.card,
        borderRadius: radius.sm,
        paddingHorizontal: end ? 6 : 5,
        paddingVertical: end ? 3 : 2,
        alignItems: 'center',
        boxShadow: shadow.hard,
      }}
    >
      <AppText
        variant="label"
        numberOfLines={1}
        style={{ color: colors.ink, fontWeight: '700', fontSize: 11, lineHeight: 14 }}
      >
        {start}
      </AppText>
      {end ? (
        <AppText
          variant="label"
          numberOfLines={1}
          style={{ color: colors.inkMuted, fontSize: 10, lineHeight: 12 }}
        >
          {end}
        </AppText>
      ) : null}
    </View>
  );
}

export function CalendarEventRow({
  title,
  where,
  startLabel,
  endLabel,
  tags,
  priceLabel,
  imageUrl,
  sponsoredLabel,
  saved,
  saveLabel,
  onPress,
  onSavePress,
}: Props) {
  const chips = priceLabel ? [...tags.slice(0, 1), priceLabel] : tags.slice(0, 2);
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        padding: space.md,
        boxShadow: shadow.soft,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            endLabel ? `${title}, ${startLabel}–${endLabel}` : `${title}, ${startLabel}`
          }
          onPress={onPress}
          style={{ flex: 1, flexDirection: 'row', gap: space.md, minWidth: 0 }}
        >
          <View style={{ width: THUMB, height: THUMB }}>
            <View
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: radius.md,
                overflow: 'hidden',
                backgroundColor: colors.accentSoft,
              }}
            >
              <EventImage imageUrl={imageUrl} tags={tags} style={{ width: THUMB, height: THUMB }} />
            </View>
            {sponsoredLabel ? (
              <View style={{ position: 'absolute', left: 4, top: 4, right: 4 }}>
                <SponsoredPill label={sponsoredLabel} size="sm" />
              </View>
            ) : null}
            <View style={{ position: 'absolute', left: 6, bottom: -6 }}>
              <TimePill start={startLabel} end={endLabel} />
            </View>
          </View>
          <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
            <AppText variant="subtitle" numberOfLines={2} style={{ fontSize: 16, lineHeight: 21 }}>
              {title}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Pin />
              <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                {where}
              </AppText>
            </View>
            <TagPills tags={chips} size="sm" />
          </View>
        </Pressable>
        {onSavePress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saveLabel}
            onPress={onSavePress}
            hitSlop={8}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            {process.env.EXPO_OS === 'ios' ? (
              <SymbolView
                name={(saved ? 'heart.fill' : 'heart') as never}
                size={18}
                tintColor={saved ? colors.accent : colors.inkMuted}
              />
            ) : (
              <MaterialIcons
                name={saved ? 'favorite' : 'favorite-border'}
                size={20}
                color={saved ? colors.accent : colors.inkMuted}
              />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
