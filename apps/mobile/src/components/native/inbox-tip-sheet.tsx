import { BottomSheet, Host } from '@expo/ui';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TipFlow } from '@/app/tips/_components/tip-flow';
import type { InboxTipTarget } from '@/lib/open-inbox-item';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

import { SheetBody } from './sheet-body';

/** Tip status opened from the notification list, over the screen that listed it. */
export function InboxTipSheet({
  target,
  onDismiss,
}: {
  target: InboxTipTarget | null;
  onDismiss: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fillsSheet = process.env.EXPO_OS === 'ios';
  const bodyHeight = fillsSheet
    ? Math.round(height - insets.top - insets.bottom - space.xxl)
    : Math.round(height * 0.9);

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={target != null}
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
            {target ? <TipFlow id={target.tipId} embedded resume onClose={onDismiss} /> : <View />}
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}
