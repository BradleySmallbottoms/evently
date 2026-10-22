import { BottomSheet, Host } from '@expo/ui';
import { useWindowDimensions, View } from 'react-native';

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
  const fillsSheet = process.env.EXPO_OS === 'ios';

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={tipId != null}
        onDismiss={onDismiss}
        snapPoints={[{ fraction: 1 }]}
        containerColor={colors.canvas}
        contentPadding={{ bottom: space.md, left: 0, right: 0, top: space.lg }}
      >
        <SheetBody fill>
          <View
            style={{
              width,
              flex: fillsSheet ? 1 : undefined,
              height: fillsSheet ? undefined : Math.round(height * 0.9),
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
