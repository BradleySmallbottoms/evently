import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  title: string;
  hint: string;
  code: string | null;
  error: string | null;
  pending: boolean;
  generateLabel: string;
  generatingLabel: string;
  onGenerate: () => void;
};

export function PairingSheet({
  isPresented,
  onDismiss,
  title,
  hint,
  code,
  error,
  pending,
  generateLabel,
  generatingLabel,
  onGenerate,
}: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet isPresented={isPresented} onDismiss={onDismiss} snapPoints={['half']}>
        <Column spacing={12}>
          <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <Text textStyle={{ fontSize: 14, color: colors.inkMuted as string }}>{hint}</Text>
          {code ? (
            <Text textStyle={{ fontSize: 28, fontWeight: '700', fontFamily: 'monospace' }}>
              {code}
            </Text>
          ) : null}
          {error ? (
            <Text textStyle={{ fontSize: 14, color: colors.danger }}>{error}</Text>
          ) : null}
          <View style={{ marginTop: space.sm }}>
            <PrimaryButton
              label={pending ? generatingLabel : generateLabel}
              loading={pending}
              onPress={onGenerate}
            />
          </View>
        </Column>
      </BottomSheet>
    </Host>
  );
}
