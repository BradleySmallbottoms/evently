import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { OnboardingCarousel } from '@/components/onboarding/onboarding-carousel';
import type { OnboardingState } from '@/lib/onboarding';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const FADE_MS = 280;
const FADE_REDUCED_MS = 120;

/**
 * Onboarding sits on top of the mounted home screen and fades away once the
 * carousel finishes. The carousel waits for the home list before it calls
 * onFinished, so the fade reveals that list.
 */
export function OnboardingCover({
  onFinished,
  onHidden,
}: {
  onFinished: (state: OnboardingState) => void;
  onHidden: () => void;
}) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const exiting = useMemo(
    () =>
      FadeOut.duration(reduced ? FADE_REDUCED_MS : FADE_MS)
        .easing(EASE_OUT)
        .withCallback((finished) => {
          'worklet';
          if (finished) scheduleOnRN(onHidden);
        }),
    [onHidden, reduced],
  );

  return visible ? (
    <Animated.View
      accessibilityViewIsModal
      collapsable={false}
      exiting={exiting}
      pointerEvents="auto"
      style={styles.cover}
    >
      <OnboardingCarousel
        onFinished={(state) => {
          onFinished(state);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setVisible(false));
          });
        }}
      />
    </Animated.View>
  ) : null;
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    zIndex: 900,
  },
});
