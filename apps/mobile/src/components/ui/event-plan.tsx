import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  title?: string;
  interestedLabel: string;
  comingLabel: string;
  hint: string;
  interested: boolean;
  coming: boolean;
  interestedCount: number;
  comingCount: number;
  interestedCountLabel: string;
  comingCountLabel: string;
  onInterestedPress: () => void;
  onComingPress: () => void;
};

function PlanGlyph({
  selected,
  sf,
  md,
}: {
  selected: boolean;
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
}) {
  const tint = selected ? colors.card : colors.ink;
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={sf as never} size={16} tintColor={tint} />;
  }
  return <MaterialIcons name={md} size={18} color={tint} />;
}

function PlanButton({
  label,
  selected,
  sf,
  md,
  onPress,
}: {
  label: string;
  selected: boolean;
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress();
      }}
      style={{
        flex: 1,
        minHeight: 48,
        borderRadius: radius.pill,
        borderCurve: 'continuous',
        borderWidth: selected ? 0 : 1.5,
        borderColor: colors.ink,
        backgroundColor: selected ? colors.primary : colors.card,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        paddingHorizontal: space.md,
      }}
    >
      <PlanGlyph selected={selected} sf={sf} md={md} />
      <AppText
        variant="label"
        style={{ color: selected ? colors.card : colors.ink, fontSize: 15, lineHeight: 20 }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function PlanCount({ count, label }: { count: number; label: string }) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${count} ${label}`}
      style={{ flex: 1, alignItems: 'center', gap: 2 }}
    >
      <AppText
        style={{
          fontSize: 22,
          lineHeight: 26,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
          color: colors.ink,
        }}
      >
        {count}
      </AppText>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

/** Save (“interested”) and “I’m coming” on the event detail screen. */
export function EventPlan({
  title,
  interestedLabel,
  comingLabel,
  hint,
  interested,
  coming,
  interestedCount,
  comingCount,
  interestedCountLabel,
  comingCountLabel,
  onInterestedPress,
  onComingPress,
}: Props) {
  return (
    <View
      style={{
        gap: space.md,
        borderTopColor: colors.separator,
        borderTopWidth: 1,
        borderBottomColor: colors.separator,
        borderBottomWidth: 1,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: colors.accentSoft,
      }}
    >
      {title ? <AppText variant="subtitle">{title}</AppText> : null}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <PlanCount count={interestedCount} label={interestedCountLabel} />
        <PlanCount count={comingCount} label={comingCountLabel} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <PlanButton
          label={interestedLabel}
          selected={interested}
          sf={interested ? 'heart.fill' : 'heart'}
          md={interested ? 'favorite' : 'favorite-border'}
          onPress={onInterestedPress}
        />
        <PlanButton
          label={comingLabel}
          selected={coming}
          sf="checkmark"
          md="check"
          onPress={onComingPress}
        />
      </View>
      <AppText variant="caption" style={{ textAlign: 'center' }}>
        {hint}
      </AppText>
    </View>
  );
}
