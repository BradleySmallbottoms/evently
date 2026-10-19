import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { EventImage } from '@/components/ui/event-image';
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

export function CalendarEventRow({
  title,
  where,
  startLabel,
  endLabel,
  tags,
  priceLabel,
  imageUrl,
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
          accessibilityLabel={title}
          onPress={onPress}
          style={{ flex: 1, flexDirection: 'row', gap: space.md, minWidth: 0 }}
        >
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
          <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
            <AppText variant="subtitle" numberOfLines={2} style={{ fontSize: 16, lineHeight: 21 }}>
              {title}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <AppText variant="label" style={{ color: colors.ink, fontSize: 13 }}>
                  {startLabel}
                </AppText>
                {endLabel ? (
                  <>
                    <AppText variant="caption" style={{ color: colors.inkMuted }}>
                      -
                    </AppText>
                    <AppText variant="caption" style={{ color: colors.inkMuted }}>
                      {endLabel}
                    </AppText>
                  </>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <Pin />
                <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                  {where}
                </AppText>
              </View>
            </View>
            <TagPills tags={chips} size="sm" />
          </View>
        </Pressable>
        {
          onSavePress ? (
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
          ) : null
        }
      </View >
    </View >
  );
}
