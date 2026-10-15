import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BottomSheet, Host } from '@expo/ui';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { ConfirmAction } from '@/components/native/confirm-action';
import { SheetBody } from '@/components/native/sheet-body';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { listTags } from '@/lib/events';
import {
  isInterestSelected,
  ONBOARDING_INTERESTS,
  tagsForInterest,
  type OnboardingInterestId,
} from '@/lib/onboarding-interests';
import { toggleGroupSelection, type HomeTag } from '@/lib/tag-groups';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  name: string;
  isPresented: boolean;
  busy?: boolean;
  onSave: (tagIds: string[]) => void;
  onSkip: () => void;
  onDismiss: () => void;
};

type Icon = { sf: SFSymbol; md: keyof typeof MaterialIcons.glyphMap; fill: string };

const INTEREST_STYLE: Record<OnboardingInterestId, Icon> = {
  music: { sf: 'music.note', md: 'music-note', fill: '#F6DCC8' },
  theatre: { sf: 'theatermasks', md: 'theater-comedy', fill: '#E4D4F5' },
  training: { sf: 'dumbbell', md: 'fitness-center', fill: '#D5EBD4' },
  museum: { sf: 'building.columns', md: 'account-balance', fill: '#D4E3F5' },
  outdoor: { sf: 'tree', md: 'park', fill: '#DCECC4' },
  food: { sf: 'fork.knife', md: 'restaurant', fill: '#F6D7C4' },
  family: { sf: 'figure.2.and.child.holdinghands', md: 'family-restroom', fill: '#F6C9D8' },
  photo: { sf: 'camera', md: 'photo-camera', fill: '#F8D0DC' },
  sport: { sf: 'soccerball', md: 'sports-soccer', fill: '#C9E6D4' },
  market: { sf: 'bag', md: 'shopping-bag', fill: '#F6D0C6' },
  talks: { sf: 'lightbulb', md: 'lightbulb-outline', fill: '#F8E8C8' },
  local: { sf: 'heart', md: 'favorite-border', fill: '#E6D4F5' },
  other: { sf: 'tag', md: 'label', fill: '#E7D7C8' },
};

const ICON_INK = '#2C241C';
const GAP = 10;

/** Onboarding interest groups, shown after a place is saved. */
export function AreaTagGroupsSheet({
  name,
  isPresented,
  busy = false,
  onSave,
  onSkip,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = windowWidth - space.xl * 2;
  const [tags, setTags] = useState<HomeTag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    if (!isPresented) {
      setSelectedIds([]);
      setConfirmEmpty(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void listTags({ upcoming: false })
      .then((result) => {
        if (!cancelled) setTags(result.items);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isPresented]);

  const cardWidth = gridWidth > 0 ? Math.floor((gridWidth - GAP * 2) / 3) : 0;

  function requestSave(tagIds: string[]) {
    if (tagIds.length === 0) {
      setConfirmEmpty(true);
      return;
    }
    onSave(tagIds);
  }

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={[{ fraction: 0.88 }]}
        containerColor={colors.card}
        contentPadding={{ top: space.lg, bottom: space.lg, left: space.xl, right: space.xl }}
      >
        <SheetBody>
          <View style={{ width: contentWidth, gap: space.md }}>
            <View style={{ gap: space.xs }}>
              <AppText variant="title">{t('events.areaTagsTitle')}</AppText>
              <AppText variant="body" style={{ color: colors.inkMuted }}>
                {t('events.areaTagsMessage', { name })}
              </AppText>
            </View>
            <ScrollView
              style={{ maxHeight: 420 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {tags == null && !failed ? (
                <ActivityIndicator color={colors.ink} style={{ marginTop: space.xl }} />
              ) : failed ? (
                <AppText variant="caption" style={{ color: colors.danger }}>
                  {t('onboarding.tagsLoadError')}
                </AppText>
              ) : (
                <View
                  onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: GAP,
                    paddingBottom: space.md,
                  }}
                >
                  {cardWidth > 0
                    ? ONBOARDING_INTERESTS.flatMap((interest) => {
                        const interestTags = tagsForInterest(tags ?? [], interest.id);
                        const ids = interestTags.map((tag) => tag.id);
                        if (ids.length === 0) return [];
                        const selected = isInterestSelected(selectedIds, ids);
                        const style = INTEREST_STYLE[interest.id];
                        return (
                          <Pressable
                            key={interest.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            accessibilityLabel={t(`onboarding.interest.${interest.id}`)}
                            disabled={busy}
                            onPress={() => {
                              if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                              setSelectedIds((current) => toggleGroupSelection(current, ids));
                            }}
                            style={{
                              width: cardWidth,
                              minHeight: 108,
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: space.sm,
                              paddingHorizontal: space.sm,
                              paddingVertical: space.md,
                              borderRadius: radius.lg,
                              borderCurve: 'continuous',
                              borderWidth: selected ? 2 : 1,
                              borderColor: selected ? colors.accent : colors.line,
                              backgroundColor: selected ? colors.accentSoft : colors.canvas,
                            }}
                          >
                            <View
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 22,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: style.fill,
                              }}
                            >
                              {process.env.EXPO_OS === 'ios' ? (
                                <SymbolView name={style.sf} size={20} tintColor={ICON_INK} />
                              ) : (
                                <MaterialIcons name={style.md} size={20} color={ICON_INK} />
                              )}
                            </View>
                            <AppText
                              numberOfLines={2}
                              style={{
                                textAlign: 'center',
                                fontSize: 13,
                                lineHeight: 16,
                                fontWeight: '600',
                                color: colors.ink,
                              }}
                            >
                              {t(`onboarding.interest.${interest.id}`)}
                            </AppText>
                          </Pressable>
                        );
                      })
                    : null}
                </View>
              )}
            </ScrollView>
            <PrimaryButton
              label={t('events.areaTagsSave')}
              loading={busy}
              disabled={tags == null && !failed}
              onPress={() => requestSave(selectedIds)}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setConfirmEmpty(true)}
              style={{ alignItems: 'center', minHeight: 44, justifyContent: 'center' }}
            >
              <AppText variant="subtitle" style={{ fontWeight: '600', color: colors.inkMuted }}>
                {t('events.areaTagsSkip')}
              </AppText>
            </Pressable>
          </View>
        </SheetBody>
        <ConfirmAction
          title={t('onboarding.skipTagsTitle')}
          message={t('onboarding.skipTagsMessage')}
          confirmLabel={t('onboarding.skipConfirm')}
          cancelLabel={t('onboarding.skipCancel')}
          isPresented={confirmEmpty}
          onIsPresentedChange={setConfirmEmpty}
          onConfirm={onSkip}
        />
      </BottomSheet>
    </Host>
  );
}
