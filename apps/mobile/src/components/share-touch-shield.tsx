import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { shareTouchShieldActive, subscribeShareTouchShield } from '@/lib/share-touch-shield';

/**
 * Catches the tap that closes the system share sheet, so it does not also
 * open whatever sits underneath, such as a similar event.
 */
export function ShareTouchShield() {
  const [active, setActive] = useState(shareTouchShieldActive);

  useEffect(() => subscribeShareTouchShield(setActive), []);

  if (!active) return null;

  return (
    <View
      style={styles.shield}
      pointerEvents="auto"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onStartShouldSetResponder={() => true}
    />
  );
}

const styles = StyleSheet.create({
  shield: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Ceiling for in-tree overlays. Later sheets and banners stay below this
    // so a share-sheet dismiss tap cannot reach them.
    zIndex: 100,
    elevation: 100,
  },
});
