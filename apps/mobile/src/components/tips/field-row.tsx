import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Choice } from './choice';
import { space } from '@/theme/tokens';

export function FieldRow({
  option,
  selected,
  locked,
  onPress,
  children,
}: {
  option?: { label: string } | null;
  selected: boolean;
  locked: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <View style={{ flex: 1 }}>{children}</View>
      {option ? (
        <Choice
          compact
          label={option.label}
          selected={selected}
          disabled={locked}
          onPress={onPress}
        />
      ) : null}
    </View>
  );
}
