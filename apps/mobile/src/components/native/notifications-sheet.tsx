import { BottomSheet, Host } from '@expo/ui';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { SheetBody } from '@/components/native/sheet-body';
import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export type NotificationRow = {
  id: string;
  title: string;
  subtitle: string;
  eventId: string | null;
  reason: string;
};

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  title: string;
  emptyMessage: string;
  loadingMessage: string;
  loading: boolean;
  items: NotificationRow[];
  onOpen: (item: NotificationRow) => void;
};

export function NotificationsSheet({
  isPresented,
  onDismiss,
  title,
  emptyMessage,
  loadingMessage,
  loading,
  items,
  onOpen,
}: Props) {
  const { height, width } = useWindowDimensions();
  const contentWidth = width - space.xl * 2;
  const fillsSheet = process.env.EXPO_OS === 'ios';
  const listHeight = Math.round(height * 0.42);

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={['half', 'full']}
        containerColor={colors.card}
        contentPadding={{ top: space.xxl, bottom: space.lg, left: space.xl, right: space.xl }}
      >
        <SheetBody fill>
          <View style={{ width: contentWidth, gap: space.md, flex: fillsSheet ? 1 : undefined }}>
            <AppText style={{ fontSize: 20, lineHeight: 26, fontWeight: '700' }}>{title}</AppText>
            {loading ? (
              <AppText variant="body" style={{ color: colors.inkMuted }}>
                {loadingMessage}
              </AppText>
            ) : items.length === 0 ? (
              <AppText variant="body" style={{ color: colors.inkMuted }}>
                {emptyMessage}
              </AppText>
            ) : (
              <ScrollView
                style={fillsSheet ? { flex: 1 } : { maxHeight: listHeight }}
                showsVerticalScrollIndicator={false}
              >
                <View style={{ gap: space.md }}>
                  {items.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => onOpen(item)}
                      disabled={!item.eventId && item.reason !== 'tip'}
                      style={{ gap: 4 }}
                    >
                      <AppText style={{ fontSize: 16, lineHeight: 21, fontWeight: '600' }}>
                        {item.title}
                      </AppText>
                      <AppText variant="caption" style={{ color: colors.inkMuted }}>
                        {item.subtitle}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}
