import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackPill } from '@/components/ui/back-pill';
import { AppText } from '@/components/ui/app-text';
import { MaxContentWidth } from '@/constants/theme';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export function TipChrome({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.xl,
          paddingBottom: space.xl,
          gap: space.lg,
          width: '100%',
          maxWidth: MaxContentWidth,
          alignSelf: 'center',
        }}
      >
        <BackPill />
        {title ? (
          <AppText variant="title" style={{ textAlign: 'center' }}>
            {title}
          </AppText>
        ) : null}
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={{
            paddingHorizontal: space.xl,
            paddingBottom: insets.bottom + space.lg,
            gap: space.sm,
            width: '100%',
            maxWidth: MaxContentWidth,
            alignSelf: 'center',
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
