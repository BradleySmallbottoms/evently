import { Host } from '@expo/ui';
import { DropdownMenu, DropdownMenuItem } from '@expo/ui/jetpack-compose';
import * as Device from 'expo-device';
import { type ReactNode } from 'react';
import { Platform, Pressable, StyleProp, View, ViewStyle } from 'react-native';

import { tipImageSources, type TipImageSource } from '@/lib/camera';

type Props = {
  cameraLabel: string;
  libraryLabel: string;
  onPick: (source: TipImageSource) => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Lets the menu close before the system picker opens. */
const DISMISS_MS = 250;

export function PhotoSourceMenu({ cameraLabel, libraryLabel, onPick, children, style }: Props) {
  const allowsCamera = tipImageSources(Platform.OS, Device.isDevice).includes('camera');

  function pick(source: TipImageSource) {
    setTimeout(() => onPick(source), DISMISS_MS);
  }

  if (!allowsCamera) {
    return (
      <Pressable onPress={() => onPick('library')} style={style}>
        {children}
      </Pressable>
    );
  }

  return (
    <View style={style}>
      <Host
        matchContents={style ? { vertical: true } : true}
        style={style ? { width: '100%' } : undefined}
      >
        <DropdownMenu>
          <DropdownMenu.Trigger>
            <View pointerEvents="none" style={style ? { alignSelf: 'stretch' } : undefined}>
              {children}
            </View>
          </DropdownMenu.Trigger>
          <DropdownMenu.Items>
            <DropdownMenuItem onClick={() => pick('camera')}>
              <DropdownMenuItem.Text>{cameraLabel}</DropdownMenuItem.Text>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => pick('library')}>
              <DropdownMenuItem.Text>{libraryLabel}</DropdownMenuItem.Text>
            </DropdownMenuItem>
          </DropdownMenu.Items>
        </DropdownMenu>
      </Host>
    </View>
  );
}
