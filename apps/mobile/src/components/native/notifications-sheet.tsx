import { BottomSheet, Column, Host, Text } from '@expo/ui';

import { colors } from '@/theme/colors';

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  title: string;
  emptyMessage: string;
};

export function NotificationsSheet({ isPresented, onDismiss, title, emptyMessage }: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet isPresented={isPresented} onDismiss={onDismiss} snapPoints={['half']}>
        <Column spacing={12}>
          <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>{emptyMessage}</Text>
        </Column>
      </BottomSheet>
    </Host>
  );
}
