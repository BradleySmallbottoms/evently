import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { DetailGlyph, IconTile } from './detail-glyph';
import { OccasionList } from './occasion-list';

type Occasion = {
  key: string;
  startsAt: string;
  endsAt?: string | null;
  venueName: string | null;
  publisherName: string;
  eventId?: string;
};

export function OccasionPeriod({
  title,
  infoLabel,
  rangeLabel,
  badgeLabel,
  badgeTone,
  hint,
  showDatesLabel,
  hideDatesLabel,
  items,
  locale,
  timeZone,
  missingVenue,
}: {
  title: string;
  infoLabel: string;
  rangeLabel: string;
  badgeLabel: string | null;
  badgeTone: 'now' | 'soon' | 'past';
  hint: string;
  showDatesLabel: string;
  hideDatesLabel: string;
  items: Occasion[];
  locale: string;
  timeZone?: string;
  missingVenue: string;
}) {
  const [open, setOpen] = useState(false);
  const badgeColor =
    badgeTone === 'now' ? colors.success : badgeTone === 'soon' ? colors.info : colors.inkMuted;
  const badgeBackground =
    badgeTone === 'now' ? colors.secondarySoft : badgeTone === 'soon' ? colors.infoSoft : colors.canvas;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <AppText style={{ fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.ink, flex: 1 }}>
          {title}
        </AppText>
        {badgeLabel ? (
          <View
            style={{
              backgroundColor: badgeBackground,
              borderRadius: radius.pill,
              paddingHorizontal: space.sm,
              paddingVertical: 4,
            }}
          >
            <AppText style={{ color: badgeColor, fontSize: 12, lineHeight: 16, fontWeight: '700' }}>
              {badgeLabel}
            </AppText>
          </View>
        ) : null}

      </View>
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
          <IconTile sf="calendar" md="event" size={32} color={colors.accent as string} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
              <AppText style={{ fontSize: 16, lineHeight: 22, fontWeight: '700' }}>
                {rangeLabel}
              </AppText>
            </View>
            <AppText variant="caption">{hint}</AppText>
          </View>
        </View>
        {items.length > 0 ? (
          <>
            <View style={{ height: 1, backgroundColor: colors.line }} />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() => setOpen((value) => !value)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
            >
              <DetailGlyph sf="list.bullet" md="list" size={16} color={colors.inkMuted as string} />
              <AppText style={{ flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>
                {open ? hideDatesLabel : showDatesLabel}
              </AppText>
              <DetailGlyph
                sf={open ? 'chevron.up' : 'chevron.down'}
                md={open ? 'expand-less' : 'expand-more'}
                size={20}
                color={colors.inkMuted as string}
              />
            </Pressable>
            {open ? (
              <OccasionList items={items} locale={locale} timeZone={timeZone} missingVenue={missingVenue} />
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}
