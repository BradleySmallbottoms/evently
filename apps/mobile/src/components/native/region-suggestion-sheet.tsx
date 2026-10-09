import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  title: string;
  message: string;
  saveNotifyLabel: string;
  saveQuietLabel: string;
  notNowLabel: string;
  neverLabel: string;
  isPresented: boolean;
  onIsPresentedChange: (open: boolean) => void;
  onSaveNotify: () => void;
  onSaveQuiet: () => void;
  onNotNow: () => void;
  onNever: () => void;
};

/** Offer to save a newly visited region (device-side suggestion). */
export function RegionSuggestionSheet({
  title,
  message,
  saveNotifyLabel,
  saveQuietLabel,
  notNowLabel,
  neverLabel,
  isPresented,
  onIsPresentedChange,
  onSaveNotify,
  onSaveQuiet,
  onNotNow,
  onNever,
}: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet isPresented={isPresented} onDismiss={() => onIsPresentedChange(false)}>
        <Column spacing={12}>
          <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>{message}</Text>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <PrimaryButton
              label={saveNotifyLabel}
              onPress={() => {
                onIsPresentedChange(false);
                onSaveNotify();
              }}
            />
            <PrimaryButton
              label={saveQuietLabel}
              onPress={() => {
                onIsPresentedChange(false);
                onSaveQuiet();
              }}
              style={{ backgroundColor: colors.ink as string }}
            />
            <PrimaryButton
              label={notNowLabel}
              onPress={() => {
                onIsPresentedChange(false);
                onNotNow();
              }}
              style={{ backgroundColor: colors.line }}
            />
            <PrimaryButton
              label={neverLabel}
              onPress={() => {
                onIsPresentedChange(false);
                onNever();
              }}
              style={{ backgroundColor: colors.line }}
            />
          </View>
        </Column>
      </BottomSheet>
    </Host>
  );
}
