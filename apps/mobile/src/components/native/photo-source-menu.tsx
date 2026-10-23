import { type ReactNode } from 'react';
import { Pressable, ViewStyle, StyleProp } from 'react-native';

import type { TipImageSource } from '@/lib/camera';

type Props = {
  cameraLabel: string;
  libraryLabel: string;
  onPick: (source: TipImageSource) => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Web fallback: open the photo library directly. */
export function PhotoSourceMenu({ onPick, children, style }: Props) {
  return (
    <Pressable onPress={() => onPick('library')} style={style}>
      {children}
    </Pressable>
  );
}
