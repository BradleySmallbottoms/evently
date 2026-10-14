import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

type Props = {
  title: string;
  message?: string;
  confirmLabel: string;
  isPresented: boolean;
  onConfirm: () => void;
};

/** System alert on Android and web. iOS uses the SwiftUI alert instead. */
export function AcknowledgeAlert({
  title,
  message,
  confirmLabel,
  isPresented,
  onConfirm,
}: Props) {
  const openRef = useRef(false);

  useEffect(() => {
    if (!isPresented) {
      openRef.current = false;
      return;
    }
    if (openRef.current) return;
    openRef.current = true;
    Alert.alert(title, message, [{ text: confirmLabel, onPress: onConfirm }], {
      cancelable: false,
    });
  }, [confirmLabel, isPresented, message, onConfirm, title]);

  return null;
}
