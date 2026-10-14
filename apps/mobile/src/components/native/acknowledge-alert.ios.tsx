import { Host } from '@expo/ui';
import { Alert, Button, RNHostView, Text } from '@expo/ui/swift-ui';
import { View } from 'react-native';

type Props = {
  title: string;
  message?: string;
  confirmLabel: string;
  isPresented: boolean;
  onConfirm: () => void;
};

/** Single-action SwiftUI alert. OK is the only button, so SwiftUI does not add Cancel. */
export function AcknowledgeAlert({
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
          /* OK is the only way to close. */
        }}
      >
        <Alert.Trigger>
          <RNHostView matchContents>
            <View style={{ width: 1, height: 1 }} collapsable={false} />
          </RNHostView>
        </Alert.Trigger>
        {message ? (
          <Alert.Message>
            <Text>{message}</Text>
          </Alert.Message>
        ) : null}
        <Alert.Actions>
          <Button role="cancel" onPress={onConfirm} label={confirmLabel} />
        </Alert.Actions>
      </Alert>
    </Host>
  );
}
