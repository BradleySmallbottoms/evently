import { BottomSheet, Host } from '@expo/ui';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TipFlow } from '@/app/tips/_components/tip-flow';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

import { SheetBody } from './sheet-body';

/** The tip chat, presented over the screen that opened it. */
export function TipChatSheet({
  tipId,
  photo,
  resume = false,
  onDismiss,
}: {
  tipId: string | null;
  photo?: string;
  resume?: boolean;
  onDismiss: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fillsSheet = process.env.EXPO_OS === 'ios';
  // A fixed height keeps the summary footer on screen the next time the sheet opens.
  // Without it the list is measured as its content and the button sits below the sheet.
  const bodyHeight = fillsSheet
    ? Math.round(height - insets.top - insets.bottom - space.xxl)
    : Math.round(height * 0.9);

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={tipId != null}
        onDismiss={onDismiss}
        snapPoints={[{ fraction: 0.9 }]}
        containerColor={colors.canvas}
        contentPadding={{ bottom: space.md, left: 0, right: 0, top: space.lg }}
      >
        <SheetBody fill>
          <View
            style={{
              width,
              height: bodyHeight,
              overflow: 'hidden',
              backgroundColor: colors.canvas,
            }}
          >
            {tipId ? (
              <TipFlow id={tipId} photo={photo} embedded resume={resume} onClose={onDismiss} />
            ) : (
              <View />
            )}
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}
