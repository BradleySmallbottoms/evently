import { Host } from '@expo/ui';
import { Button, ConfirmationDialog, RNHostView, Text } from '@expo/ui/swift-ui';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';

type Props = {
  eyebrow: string;
  locationLabel: string;
  title: string;
  message: string;
  useNearbyLabel: string;
  useFallbackLabel: string;
  isPresented: boolean;
  onIsPresentedChange: (open: boolean) => void;
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
  isPresented,
  onIsPresentedChange,
  onUseNearby,
  onUseFallback,
}: Props) {
  return (
    <Host matchContents>
      <ConfirmationDialog
        title={title}
        isPresented={isPresented}
        onIsPresentedChange={onIsPresentedChange}
      >
        <ConfirmationDialog.Trigger>
          <RNHostView matchContents>
            <Pressable onPress={() => onIsPresentedChange(true)}>
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
          </RNHostView>
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Message>
          <Text>{message}</Text>
        </ConfirmationDialog.Message>
        <ConfirmationDialog.Actions>
          <Button
            onPress={() => {
              onIsPresentedChange(false);
              onUseNearby();
            }}
            label={useNearbyLabel}
          />
          <Button
            onPress={() => {
              onIsPresentedChange(false);
              onUseFallback();
            }}
            label={useFallbackLabel}
          />
        </ConfirmationDialog.Actions>
      </ConfirmationDialog>
    </Host>
  );
}
