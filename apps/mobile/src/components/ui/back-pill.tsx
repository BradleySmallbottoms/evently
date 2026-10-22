import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

type Props = {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  showLabel?: boolean;
};

/** White pill with a chevron and “Back”, matching the event detail overlay. */
export function BackPill({ onPress, style, showLabel = true }: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('events.back')}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        if (onPress) onPress();
        else router.back();
      }}
      style={({ pressed }) => [
        {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          minHeight: 44,
          paddingLeft: space.sm,
          paddingRight: space.md,
          borderRadius: radius.pill,
          backgroundColor: showLabel ? colors.card : 'transparent',
          opacity: pressed ? 0.88 : 1,
          boxShadow: shadow.soft,
          width: '25%',
        },
        style,
      ]}
    >
      {process.env.EXPO_OS === 'ios' ? (
        <SymbolView name={'chevron.left' as never} size={16} tintColor={colors.ink} />
      ) : (
        <MaterialIcons name="chevron-left" size={20} color={colors.ink} />
      )}
      {showLabel ? (
        <AppText style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
          {t('events.back')}
        </AppText>
      ) : null}
    </Pressable>
  );
}
