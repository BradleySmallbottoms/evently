import { Host } from '@expo/ui';
import { Alert, Button, Text } from '@expo/ui/swift-ui';

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  isPresented: boolean;
  onIsPresentedChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** SwiftUI alert confirmation dialog (iOS). */
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
    <Host matchContents>
      <Alert title={title} isPresented={isPresented} onIsPresentedChange={onIsPresentedChange}>
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
