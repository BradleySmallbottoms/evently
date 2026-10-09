import { SymbolView } from 'expo-symbols';
import { TextInput, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, space, typography } from '@/theme/tokens';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
};

export function SearchBar({ value, onChangeText, placeholder }: Props) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: colors.card as string,
        borderRadius: radius.xl,
        borderCurve: 'continuous',
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <SymbolView name={'magnifyingglass' as never} size={18} tintColor={colors.inkFaint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        style={{
          flex: 1,
          fontFamily: typography.familyRegular,
          fontSize: 15,
          color: colors.ink,
          padding: 0,
        }}
      />
    </View>
  );
}
