import { BottomSheet, Host } from '@expo/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { SheetBody } from '@/components/native/sheet-body';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { groupHomeTags, toggleGroupSelection, type HomeTag } from '@/lib/tag-groups';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Price = 'any' | 'free' | 'paid';

type Props = {
  isPresented: boolean;
  tags: HomeTag[];
  tagIds: string[];
  price: Price;
  onDismiss: () => void;
  onApply: (tagIds: string[], price: Price) => void;
};

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.line,
        backgroundColor: selected ? colors.accentSoft : colors.card,
      }}
    >
      <AppText variant="label" style={{ color: colors.ink }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function CalendarFilterSheet({
  isPresented,
  tags,
  tagIds,
  price,
  onDismiss,
  onApply,
}: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const contentWidth = width - space.xl * 2;
  const [open, setOpen] = useState(false);
  const [draftTags, setDraftTags] = useState(tagIds);
  const [draftPrice, setDraftPrice] = useState(price);
  if (isPresented !== open) {
    setOpen(isPresented);
    if (isPresented) {
      setDraftTags(tagIds);
      setDraftPrice(price);
    }
  }
  const groups = groupHomeTags(tags);

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={[{ fraction: 0.72 }]}
        containerColor={colors.card}
        contentPadding={{ top: space.lg, bottom: space.lg, left: space.xl, right: space.xl }}
      >
        <SheetBody fill>
          <View style={{ width: contentWidth, flex: 1, gap: space.lg }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <AppText variant="subtitle">{t('events.calendar.filters')}</AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDraftTags([]);
                  setDraftPrice('any');
                }}
              >
                <AppText variant="label" style={{ color: colors.accent }}>
                  {t('events.calendar.clear')}
                </AppText>
              </Pressable>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ gap: space.lg, paddingBottom: space.md }}
              showsVerticalScrollIndicator={false}
            >
              <View style={{ gap: space.sm }}>
                <AppText variant="label">{t('events.calendar.categories')}</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {groups.map((group) => {
                    const ids = group.tags.map((tag) => tag.id);
                    const selected = ids.length > 0 && ids.every((id) => draftTags.includes(id));
                    return (
                      <Chip
                        key={group.id}
                        label={t(`events.tagGroup.${group.id}`)}
                        selected={selected}
                        onPress={() => setDraftTags(toggleGroupSelection(draftTags, ids))}
                      />
                    );
                  })}
                </View>
              </View>
              <View style={{ gap: space.sm }}>
                <AppText variant="label">{t('events.price')}</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  <Chip
                    label={t('events.priceAny')}
                    selected={draftPrice === 'any'}
                    onPress={() => setDraftPrice('any')}
                  />
                  <Chip
                    label={t('events.free')}
                    selected={draftPrice === 'free'}
                    onPress={() => setDraftPrice('free')}
                  />
                  <Chip
                    label={t('events.pricePaid')}
                    selected={draftPrice === 'paid'}
                    onPress={() => setDraftPrice('paid')}
                  />
                </View>
              </View>
            </ScrollView>
            <PrimaryButton
              label={t('events.calendar.showEvents')}
              onPress={() => onApply(draftTags, draftPrice)}
            />
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}
