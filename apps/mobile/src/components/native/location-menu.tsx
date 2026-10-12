import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  eyebrow?: string;
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
      <Pressable onPress={() => setOpen(true)} style={{ flexShrink: 1, minWidth: 0, maxWidth: '100%' }}>
        <View style={{ gap: eyebrow ? 2 : 0, maxWidth: '100%' }}>
          {eyebrow ? (
            <AppText variant="caption" numberOfLines={1}>
              {eyebrow}
            </AppText>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <MaterialIcons name="my-location" size={16} color={colors.ink} />
            <AppText variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
              {locationLabel}
            </AppText>
            <MaterialIcons name="expand-more" size={16} color={colors.inkMuted} />
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
