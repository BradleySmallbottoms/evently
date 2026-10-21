import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { EventImage } from '@/components/ui/event-image';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

import { DetailGlyph } from './detail-glyph';

export type RelatedEvent = {
  id: string;
  title: string;
  when: string;
  where: string;
  imageUrl: string | null;
  tags: string[];
  saved: boolean;
};

export function RelatedEvents({
  title,
  seeAllLabel,
  onSeeAll,
  items,
  savedLabel,
  unsavedLabel,
  onPress,
  onSave,
}: {
  title: string;
  seeAllLabel: string;
  onSeeAll?: () => void;
  items: RelatedEvent[];
  savedLabel: string;
  unsavedLabel: string;
  onPress: (id: string) => void;
  onSave: (id: string, saved: boolean) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
        }}
      >
        <AppText
          style={{ fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.ink, flex: 1 }}
        >
          {title}
        </AppText>
        {onSeeAll ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={seeAllLabel}
            onPress={onSeeAll}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <AppText
              style={{ color: colors.info, fontSize: 15, lineHeight: 20, fontWeight: '600' }}
            >
              {seeAllLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <View style={{ gap: space.md }}>
        {items.map((item) => (
          <View
            key={item.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              backgroundColor: colors.card,
              borderRadius: radius.lg,
              borderCurve: 'continuous',
              padding: space.sm,
              boxShadow: shadow.card,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() => onPress(item.id)}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md }}
            >
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: radius.md,
                  borderCurve: 'continuous',
                  overflow: 'hidden',
                  backgroundColor: colors.accentSoft,
                }}
              >
                <EventImage imageUrl={item.imageUrl} tags={item.tags} />
              </View>
              <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                <AppText
                  numberOfLines={2}
                  style={{ fontSize: 16, lineHeight: 21, fontWeight: '700' }}
                >
                  {item.title}
                </AppText>
                <AppText variant="caption" numberOfLines={2}>
                  {[item.when, item.where].filter(Boolean).join(' · ')}
                </AppText>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.saved ? savedLabel : unsavedLabel}
              onPress={() => onSave(item.id, item.saved)}
              hitSlop={8}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <DetailGlyph
                sf={item.saved ? 'heart.fill' : 'heart'}
                md={item.saved ? 'favorite' : 'favorite-border'}
                color={item.saved ? (colors.accent as string) : (colors.inkMuted as string)}
              />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
