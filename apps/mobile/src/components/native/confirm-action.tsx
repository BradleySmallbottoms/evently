import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  isPresented: boolean;
  onIsPresentedChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** Universal BottomSheet confirmation fallback (Android / web). */
export function ConfirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel,
  isPresented,
  onIsPresentedChange,
  onConfirm,
}: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet isPresented={isPresented} onDismiss={() => onIsPresentedChange(false)}>
        <Column spacing={12}>
          <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>{message}</Text>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <PrimaryButton
              label={confirmLabel}
              onPress={() => {
                onIsPresentedChange(false);
                onConfirm();
              }}
            />
            <PrimaryButton
              label={cancelLabel}
              onPress={() => onIsPresentedChange(false)}
              style={{ backgroundColor: colors.line }}
            />
          </View>
        </Column>
      </BottomSheet>
    </Host>
  );
}
