import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  eyebrow: string;
  locationLabel: string;
  title: string;
  message: string;
  useNearbyLabel: string;
  useFallbackLabel: string;
  isPresented?: boolean;
  onIsPresentedChange?: (open: boolean) => void;
  onUseNearby: () => void;
  onUseFallback: () => void;
};

export function LocationMenu({
  eyebrow,
  locationLabel,
  title,
  message,
  useNearbyLabel,
  useFallbackLabel,
  onUseNearby,
  onUseFallback,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable onPress={() => setOpen(true)}>
        <View style={{ gap: 2 }}>
          <AppText variant="caption">{eyebrow}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <AppText variant="subtitle">{locationLabel}</AppText>
            <SymbolView
              name={'chevron.down' as never}
              size={12}
              tintColor={colors.inkMuted as string}
            />
          </View>
        </View>
      </Pressable>
      <Host style={{ position: 'absolute', width: 0, height: 0 }}>
        <BottomSheet isPresented={open} onDismiss={() => setOpen(false)}>
          <Column spacing={12}>
            <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
            <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>{message}</Text>
            <View style={{ gap: space.sm }}>
              <PrimaryButton
                label={useNearbyLabel}
                onPress={() => {
                  setOpen(false);
                  onUseNearby();
                }}
              />
              <PrimaryButton
                label={useFallbackLabel}
                onPress={() => {
                  setOpen(false);
                  onUseFallback();
                }}
                style={{ backgroundColor: colors.ink }}
              />
            </View>
          </Column>
        </BottomSheet>
      </Host>
    </>
  );
}
