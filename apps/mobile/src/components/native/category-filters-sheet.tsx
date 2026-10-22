import { BottomSheet, Host } from '@expo/ui';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { SheetBody } from '@/components/native/sheet-body';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  children: ReactElement;
  /** Events the current tags will show. Omitted until the count arrives. */
  eventCount?: number;
};

/** Home categories. More opens this sheet; the row of circles stays on the page. */
export function CategoryFiltersSheet({ isPresented, onDismiss, children, eventCount }: Props) {
  const { t } = useTranslation();
  const { height, width } = useWindowDimensions();
  const contentWidth = width - space.xl * 2;
  const fillsSheet = process.env.EXPO_OS === 'ios';
  const bodyHeight = Math.round(height * 0.78);

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={[{ fraction: 0.88 }]}
        containerColor={colors.card}
        contentPadding={{ top: space.xxl, bottom: space.lg, left: space.xl, right: space.xl }}
      >
        <SheetBody fill>
          <View
            style={{
              width: contentWidth,
              flex: fillsSheet ? 1 : undefined,
              height: fillsSheet ? undefined : bodyHeight,
            }}
          >
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: space.md }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            <PrimaryButton
              label={
                eventCount == null
                  ? t('events.showEvents')
                  : t('events.showEventsCount', { count: eventCount })
              }
              onPress={onDismiss}
            />
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}
