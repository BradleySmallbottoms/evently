import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { listTags } from '@/lib/events';
import {
  ONBOARDING_INTERESTS,
  tagsForInterest,
  isInterestSelected,
  type OnboardingInterestId,
} from '@/lib/onboarding-interests';
import { toggleGroupSelection, type HomeTag } from '@/lib/tag-groups';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

type Props = {
  busy: boolean;
  confirmed?: boolean;
  onConfirmed?: () => void;
  onContinue: (tagIds: string[]) => void;
  onSkip: () => void;
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

/** Interest cards. Each card selects every loaded tag in that interest. Skip stores nothing. */
export function OnboardingTagsStep({
  busy,
  confirmed = false,
  onConfirmed,
  onContinue,
  onSkip,
}: Props) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<HomeTag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  const cardWidth = gridWidth > 0 ? Math.floor((gridWidth - GAP * 2) / 3) : 0;

  return (
    <View style={{ flex: 1, gap: space.md }}>
      <View style={{ flex: 1, minHeight: 0 }}>
        {tags == null && !failed ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : failed ? (
          <AppText variant="caption" style={{ color: '#FFFFFF', textAlign: 'center' }}>
            {t('onboarding.tagsLoadError')}
          </AppText>
        ) : (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          >
            <View
              onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}
            >
              {cardWidth > 0
                ? ONBOARDING_INTERESTS.flatMap((interest) => {
                    const interestTags = tagsForInterest(tags ?? [], interest.id);
                    const ids = interestTags.map((tag) => tag.id);
                    if (ids.length === 0) return [];
                    const selected = isInterestSelected(selectedIds, ids);
                    return (
                      <InterestCard
                        key={interest.id}
                        id={interest.id}
                        label={t(`onboarding.interest.${interest.id}`)}
                        width={cardWidth}
                        selected={selected}
                        onPress={() => {
                          if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                          setSelectedIds((current) => toggleGroupSelection(current, ids));
                        }}
                      />
                    );
                  })
                : null}
            </View>
          </ScrollView>
        )}
      </View>
      <PrimaryButton
        label={t('onboarding.finish')}
        icon={{ sf: 'heart', md: 'favorite-border' }}
        loading={busy}
        disabled={tags == null && !failed}
        confirmed={confirmed}
        onConfirmed={onConfirmed}
        onPress={() => onContinue(selectedIds)}
      />
      <SkipRow label={t('onboarding.skip')} disabled={busy || confirmed} onPress={onSkip} />
    </View>
  );
}

function InterestCard({
  id,
  label,
  width,
  selected,
  disabled,
  onPress,
}: {
  id: OnboardingInterestId;
  label: string;
  width: number;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const style = INTEREST_STYLE[id];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width,
        minHeight: 108,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        paddingHorizontal: space.sm,
        paddingTop: space.lg,
        paddingBottom: space.md,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected ? colors.accent : 'rgba(255,255,255,0.5)',
        backgroundColor: selected ? colors.accentSoftAlpha : 'rgba(20, 16, 14, 0.28)',
        opacity: disabled ? 0.4 : pressed ? 0.5 : 1,
      })}
    >
      {selected ? <CheckBadge /> : null}
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: style.fill,
        }}
      >
        {process.env.EXPO_OS === 'ios' ? (
          <SymbolView name={style.sf} size={22} tintColor={ICON_INK} />
        ) : (
          <MaterialIcons name={style.md} size={22} color={ICON_INK} />
        )}
      </View>
      <AppText
        numberOfLines={2}
        style={{
          color: '#FFFFFF',
          textAlign: 'center',
          fontSize: 13,
          lineHeight: 16,
          fontWeight: '600',
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function CheckBadge() {
  return (
    <View
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accent,
      }}
    >
      {process.env.EXPO_OS === 'ios' ? (
        <SymbolView name="checkmark" size={12} tintColor="#FFFFFF" weight="bold" />
      ) : (
        <MaterialIcons name="check" size={14} color="#FFFFFF" />
      )}
    </View>
  );
}

function SkipRow({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        paddingVertical: space.xs,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <AppText
        variant="caption"
        style={{
          color: '#FFFFFF',
          fontSize: 15,
          fontWeight: '600',
          textDecorationLine: 'underline',
          textShadowColor: 'rgba(0, 0, 0, 0.45)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 2,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}
