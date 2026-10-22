import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export function Choice({
  label,
  selected,
  disabled,
  compact,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  compact?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <AppText variant="label" style={{ color: colors.ink, textAlign: 'center' }}>
      {label}
    </AppText>
  );
  if (!onPress) {
    return (
      <View
        style={{
          flex: compact ? undefined : 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? colors.accent : colors.card,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: selected ? colors.accent : colors.line,
          paddingVertical: space.sm,
          paddingHorizontal: compact ? space.md : 0,
          maxWidth: compact ? 120 : undefined,
          opacity: disabled && !selected ? 0.45 : 1,
        }}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: compact ? undefined : 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? colors.accent : colors.card,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.line,
        paddingVertical: space.sm,
        paddingHorizontal: compact ? space.md : 0,
        maxWidth: compact ? 120 : undefined,
        opacity: disabled && !selected ? 0.45 : 1,
      }}
    >
      {content}
    </Pressable>
  );
}
