import { Host } from '@expo/ui';
import { Button, Menu, RNHostView } from '@expo/ui/swift-ui';
import * as Device from 'expo-device';
import { type ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { tipImageSources, type TipImageSource } from '@/lib/camera';

type Props = {
  cameraLabel: string;
  libraryLabel: string;
  onPick: (source: TipImageSource) => void;
  children: ReactNode;
};

/** Lets the menu close before the system picker opens. */
const DISMISS_MS = 250;

export function PhotoSourceMenu({ cameraLabel, libraryLabel, onPick, children }: Props) {
  const allowsCamera = tipImageSources(Platform.OS, Device.isDevice).includes('camera');

  function pick(source: TipImageSource) {
    setTimeout(() => onPick(source), DISMISS_MS);
  }

  if (!allowsCamera) {
    return <Pressable onPress={() => onPick('library')}>{children}</Pressable>;
  }

  return (
    <Host matchContents>
      <Menu
        label={
          <RNHostView matchContents>
            <View pointerEvents="none">{children}</View>
          </RNHostView>
        }
      >
        <Button label={cameraLabel} onPress={() => pick('camera')} />
        <Button label={libraryLabel} onPress={() => pick('library')} />
      </Menu>
    </Host>
  );
}
