import { Host } from '@expo/ui';
import { Alert, Button, RNHostView, Text } from '@expo/ui/swift-ui';
import { View } from 'react-native';

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  isPresented: boolean;
  onIsPresentedChange: (open: boolean) => void;
  onConfirm: () => void;
};

/**
 * SwiftUI alert confirmation (iOS). Alert must have a Trigger — EmptyView does not
 * present `.alert` reliably, so we mount a 1×1 RN host as the anchor.
 */
export function ConfirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel,
  isPresented,
  onIsPresentedChange,
  onConfirm,
}: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <Alert title={title} isPresented={isPresented} onIsPresentedChange={onIsPresentedChange}>
        <Alert.Trigger>
          <RNHostView matchContents>
            <View style={{ width: 1, height: 1 }} collapsable={false} />
          </RNHostView>
        </Alert.Trigger>
        <Alert.Message>
          <Text>{message}</Text>
        </Alert.Message>
        <Alert.Actions>
          <Button role="cancel" onPress={() => onIsPresentedChange(false)} label={cancelLabel} />
          <Button
            role="destructive"
            onPress={() => {
              onIsPresentedChange(false);
              onConfirm();
            }}
            label={confirmLabel}
          />
        </Alert.Actions>
      </Alert>
    </Host>
  );
}
