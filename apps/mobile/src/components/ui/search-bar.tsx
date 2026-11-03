import type { ComponentRef, Ref } from 'react';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppearance, useSchemeKey } from '@/lib/appearance-context';
import { colors } from '@/theme/colors';
import { manrope } from '@/theme/type';
import { radius, space } from '@/theme/tokens';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  inputRef?: Ref<ComponentRef<typeof TextInput>>;
  /** When set, the field is a button and does not take keyboard focus itself. */
  onPress?: () => void;
};

export function SearchBar({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  inputRef,
  onPress,
}: Props) {
  const { t } = useTranslation();
  const { scheme } = useAppearance();
  const paint = useSchemeKey();
  const barStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderCurve: 'continuous' as const,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    minHeight: 48,
    paddingVertical: space.md,
  };

  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={placeholder} onPress={onPress}>
        <View key={paint} collapsable={false} style={barStyle}>
          <SymbolView name={'magnifyingglass' as never} size={18} tintColor={colors.inkFaint} />
          <AppText style={{ flex: 1, fontSize: 16, color: colors.inkFaint }}>{placeholder}</AppText>
        </View>
      </Pressable>
    );
  }

  return (
    <View key={paint} collapsable={false} style={barStyle}>
      <SymbolView name={'magnifyingglass' as never} size={18} tintColor={colors.inkFaint} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        keyboardAppearance={scheme}
        autoFocus={autoFocus}
        style={{
          flex: 1,
          fontFamily: manrope.regular,
          fontSize: 16,
          color: colors.ink,
          padding: 0,
        }}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('events.searchClear')}
          hitSlop={8}
          onPress={() => onChangeText('')}
        >
          <SymbolView name={'xmark.circle.fill' as never} size={18} tintColor={colors.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}
