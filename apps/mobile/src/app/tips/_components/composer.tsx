import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { TextInput, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export function Composer({
  value,
  onChange,
  placeholder,
  editable,
  tall,
  single,
  icon,
  keyboardType,
  autoCapitalize,
  onFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  editable: boolean;
  tall?: boolean;
  single?: boolean;
  icon?: 'place';
  keyboardType?: 'url' | 'decimal-pad';
  autoCapitalize?: 'none';
  onFocus?: () => void;
}) {
  const field = (
    <TextInput
      value={value}
      onChangeText={onChange}
      editable={editable}
      multiline={!single && !keyboardType}
      maxLength={500}
      placeholder={placeholder}
      placeholderTextColor={colors.inkMuted}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      onFocus={onFocus}
      style={{
        flex: icon ? 1 : undefined,
        minHeight: tall ? 160 : 52,
        maxHeight: 160,
        backgroundColor: icon ? 'transparent' : colors.card,
        borderRadius: radius.lg,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        color: colors.ink,
        fontSize: 16,
        textAlignVertical: single || icon ? 'center' : 'top',
        opacity: editable ? 1 : 0.6,
      }}
    />
  );
  if (!icon) return field;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 52,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        paddingLeft: space.md,
      }}
    >
      <MaterialIcons name="place" size={20} color={colors.inkMuted} />
      {field}
    </View>
  );
}
