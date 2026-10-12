import { Host } from '@expo/ui';
import { Button, ConfirmationDialog, RNHostView, Text } from '@expo/ui/swift-ui';
import { fixedSize } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';

type Props = {
  eyebrow?: string;
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
    <Host matchContents style={{ alignSelf: 'flex-end', flexShrink: 1, maxWidth: '100%' }}>
      <ConfirmationDialog
        title={title}
        isPresented={isPresented}
        onIsPresentedChange={onIsPresentedChange}
        modifiers={[fixedSize({ horizontal: true, vertical: true })]}
      >
        <ConfirmationDialog.Trigger>
          <RNHostView matchContents>
            <Pressable onPress={() => onIsPresentedChange(true)}>
              <View style={{ gap: 2, alignSelf: 'flex-start', maxWidth: '100%' }}>
                {eyebrow ? (
                  <AppText variant="caption" numberOfLines={1}>
                    {eyebrow}
                  </AppText>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                  <SymbolView
                    name={'location.fill' as never}
                    size={16}
                    tintColor={colors.ink as string}
                  />
                  <AppText variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {locationLabel}
                  </AppText>
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
