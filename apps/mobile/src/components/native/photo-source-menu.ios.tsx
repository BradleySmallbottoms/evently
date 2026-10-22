import { Host } from '@expo/ui';
import { Button, ConfirmationDialog, RNHostView } from '@expo/ui/swift-ui';
import * as Device from 'expo-device';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { tipImageSources, type TipImageSource } from '@/lib/camera';

type Props = {
  cameraLabel: string;
  libraryLabel: string;
  onPick: (source: TipImageSource) => void;
  children: ReactNode;
};

/** Lets the sheet close before the system picker opens. */
const DISMISS_MS = 250;

/**
 * The card stays in the React Native layout. A SwiftUI menu used the card as
 * its label, and opening it moved that label off screen; the menu then sat on
 * the stray frame and a tap only dismissed it. The dialog is anchored to the
 * card, so the choices open on the button that was tapped.
 */
export function PhotoSourceMenu({ cameraLabel, libraryLabel, onPick, children }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ width: 0, height: 0 });
  const allowsCamera = tipImageSources(Platform.OS, Device.isDevice).includes('camera');

  function pick(source: TipImageSource) {
    setOpen(false);
    setTimeout(() => onPick(source), DISMISS_MS);
  }

  if (!allowsCamera) {
    return (
      <Pressable accessibilityRole="button" onPress={() => onPick('library')}>
        {children}
      </Pressable>
    );
  }

  return (
    <View
      onLayout={(event) => {
        const width = Math.round(event.nativeEvent.layout.width);
        const height = Math.round(event.nativeEvent.layout.height);
        if (width <= 0 || height <= 0) return;
        setAnchor((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }}
    >
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        {children}
      </Pressable>
      {anchor.width > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: anchor.width,
            height: anchor.height,
          }}
        >
          <Host style={{ width: anchor.width, height: anchor.height }}>
            <ConfirmationDialog
              title={t('tips.photoSource')}
              isPresented={open}
              onIsPresentedChange={setOpen}
            >
              <ConfirmationDialog.Trigger>
                <RNHostView matchContents>
                  <View
                    collapsable={false}
                    style={{ width: anchor.width, height: anchor.height }}
                  />
                </RNHostView>
              </ConfirmationDialog.Trigger>
              <ConfirmationDialog.Actions>
                <Button label={cameraLabel} onPress={() => pick('camera')} />
                <Button label={libraryLabel} onPress={() => pick('library')} />
                <Button role="cancel" label={t('tips.cancel')} onPress={() => setOpen(false)} />
              </ConfirmationDialog.Actions>
            </ConfirmationDialog>
          </Host>
        </View>
      ) : null}
    </View>
  );
}
