import { useLocalSearchParams } from 'expo-router';
import { type ReactNode } from 'react';
import Animated, { useReducedMotion, withSpring } from 'react-native-reanimated';

import { useSchemeKey } from '@/lib/appearance-context';
import { colors } from '@/theme/colors';

import { PublishedTipView } from '@/components/tips/published-tip-view';

/** Scale settle on top of the navigator fade. Reduced motion keeps that fade only. */
function thankYouBounce() {
  'worklet';
  return {
    initialValues: {
      transform: [{ scale: 0.9 }],
    },
    animations: {
      transform: [{ scale: withSpring(1, { damping: 12, stiffness: 220, mass: 0.6 }) }],
    },
  };
}

export default function PublishedTipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return (
    <ThankYouModal>
      <PublishedTipView id={id} />
    </ThankYouModal>
  );
}

function ThankYouModal({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const paint = useSchemeKey();
  return (
    <Animated.View
      key={paint}
      entering={reduced ? undefined : thankYouBounce}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      {children}
    </Animated.View>
  );
}
