import { Host } from '@expo/ui';
import { Alert, Button, RNHostView, Text } from '@expo/ui/swift-ui';
import { View } from 'react-native';

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  isPresented: boolean;
  onConfirm: () => void;
};

/**
 * Single-action SwiftUI alert. The stored identity is gone, so dismissing
 * without the button leaves the alert presented.
 */
export function IdentityResetAlert({
  title,
  message,
  confirmLabel,
  isPresented,
  onConfirm,
}: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <Alert
        title={title}
        isPresented={isPresented}
        onIsPresentedChange={() => {
          /* Confirmation is the only way forward. */
        }}
      >
        <Alert.Trigger>
          <RNHostView matchContents>
            <View style={{ width: 1, height: 1 }} collapsable={false} />
          </RNHostView>
        </Alert.Trigger>
        <Alert.Message>
          <Text>{message}</Text>
        </Alert.Message>
        <Alert.Actions>
          {/* SwiftUI adds its own Cancel button unless one action uses the cancel role. */}
          <Button role="cancel" onPress={onConfirm} label={confirmLabel} />
        </Alert.Actions>
      </Alert>
    </Host>
  );
}
