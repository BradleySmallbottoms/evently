import { type ReactNode } from 'react';
import { Pressable } from 'react-native';

import type { TipImageSource } from '@/lib/camera';

type Props = {
  cameraLabel: string;
  libraryLabel: string;
  onPick: (source: TipImageSource) => void;
  children: ReactNode;
};

/** Web fallback: open the photo library directly. */
export function PhotoSourceMenu({ onPick, children }: Props) {
  return <Pressable onPress={() => onPick('library')}>{children}</Pressable>;
}
