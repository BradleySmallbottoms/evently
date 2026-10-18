import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { DateBox } from '@/components/ui/date-box';
import { dateBadge } from '@/lib/event-format';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Occasion = {
  key: string;
  startsAt: string;
  endsAt?: string | null;
  venueName: string | null;
  publisherName: string;
  /** Set when this row is another event. A folded occasion stays on this page. */
  eventId?: string;
};

export function OccasionList({
  title,
  items,
  locale,
  missingVenue,
}: {
  title: string;
  items: Occasion[];
  locale: string;
  missingVenue: string;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="subtitle">{title}</AppText>
      <View style={{ gap: space.sm }}>
        {items.map((item) => {
          const where = item.venueName || item.publisherName || missingVenue;
          const start = new Date(item.startsAt).toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
          });
          const end = item.endsAt
            ? new Date(item.endsAt).toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit',
              })
            : null;
          const when = end ? `${start} – ${end}` : start;
          const row = (
            <>
              <DateBox badge={dateBadge(item.startsAt, locale)} surface={colors.accentSoft} />
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <AppText variant="subtitle" style={{ fontSize: 16, lineHeight: 21 }}>
                  {when}
                </AppText>
                <AppText variant="caption" numberOfLines={1}>
                  {where}
                </AppText>
              </View>
              {item.eventId ? (
                process.env.EXPO_OS === 'ios' ? (
                  <SymbolView name={'chevron.right' as never} size={14} tintColor={colors.inkMuted} />
                ) : (
                  <MaterialIcons name="chevron-right" size={20} color={colors.inkMuted} />
                )
              ) : null}
            </>
          );
          const style = {
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            gap: space.md,
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderCurve: 'continuous' as const,
            padding: space.md,
          };
          if (!item.eventId) {
            return (
              <View key={item.key} accessibilityLabel={`${when}, ${where}`} style={style}>
                {row}
              </View>
            );
          }
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${when}, ${where}`}
              onPress={() => router.push(`/events/${item.eventId}`)}
              style={style}
            >
              {row}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
