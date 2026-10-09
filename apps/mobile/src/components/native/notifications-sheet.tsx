import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { Pressable, ScrollView, View } from 'react-native';

import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export type NotificationRow = {
  id: string;
  title: string;
  subtitle: string;
  eventId: string;
};

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  title: string;
  emptyMessage: string;
  loadingMessage: string;
  loading: boolean;
  items: NotificationRow[];
  onOpenEvent: (eventId: string) => void;
};

export function NotificationsSheet({
  isPresented,
  onDismiss,
  title,
  emptyMessage,
  loadingMessage,
  loading,
  items,
  onOpenEvent,
}: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet isPresented={isPresented} onDismiss={onDismiss} snapPoints={['half', 'full']}>
        <Column spacing={12}>
          <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
          {loading ? (
            <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>
              {loadingMessage}
            </Text>
          ) : items.length === 0 ? (
            <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>
              {emptyMessage}
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 360 }}>
              <View style={{ gap: space.md }}>
                {items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => onOpenEvent(item.eventId)}
                    style={{ gap: 4 }}
                  >
                    <Text textStyle={{ fontSize: 16, fontWeight: '600' }}>{item.title}</Text>
                    <Text textStyle={{ fontSize: 13, color: colors.inkMuted as string }}>
                      {item.subtitle}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </Column>
      </BottomSheet>
    </Host>
  );
}
