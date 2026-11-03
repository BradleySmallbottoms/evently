import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppearance } from '@/lib/appearance-context';
import type { AppearancePreference } from '@/lib/appearance';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const OPTIONS: AppearancePreference[] = ['system', 'light', 'dark'];

/** Profile control for light, dark, or the device appearance. */
export function AppearanceSetting() {
  const { t } = useTranslation();
  const { preference, setPreference } = useAppearance();
  const label: Record<AppearancePreference, string> = {
    system: t('profile.appearanceSystem'),
    light: t('profile.appearanceLight'),
    dark: t('profile.appearanceDark'),
  };

  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="subtitle">{t('profile.appearance')}</AppText>
      <AppText variant="caption">{t('profile.appearanceHint')}</AppText>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: space.sm }}>
        {OPTIONS.map((option) => {
          const selected = preference === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={label[option]}
              onPress={() => setPreference(option)}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: space.sm,
                borderRadius: radius.pill,
                borderCurve: 'continuous',
                borderWidth: selected ? 0 : 1,
                borderColor: colors.line,
                backgroundColor: selected ? colors.ink : colors.card,
              }}
            >
              <AppText
                variant="label"
                style={{ color: selected ? colors.card : colors.ink, fontWeight: '600' }}
              >
                {label[option]}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
