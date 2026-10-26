import { deviceAssetUrl } from '@local-events/domain';
import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { API_URL } from '@/lib/api';
import { eventPlaceholderKind, type EventPlaceholderKind } from '@/lib/event-placeholder';

const placeholders: Record<EventPlaceholderKind, number> = {
  music: require('@/assets/images/placeholder-music.png'),
  workout: require('@/assets/images/placeholder-workout.png'),
  lecture: require('@/assets/images/placeholder-lecture.png'),
  culture: require('@/assets/images/placeholder-culture.png'),
  generic: require('@/assets/images/placeholder-generic.png'),
};

/** Warm gray held until the photo is painted. A cold gray would flash against the canvas. */
const LOADING_SURFACE = '#DDD6CC';
const SWEEP_MS = 1400;
const FADE_MS = 180;

type Props = {
  imageUrl?: string | null;
  /** Tag names. Used to choose a placeholder when the event has no photo. */
  tags?: readonly string[];
  style?: ImageProps['style'];
};

/** Expo Go on a phone cannot open Garage at `*.localhost`. Load those via the API. */
function imageUri(imageUrl: string): string {
  if (Platform.OS === 'web') return imageUrl;
  return deviceAssetUrl(imageUrl, API_URL);
}

/**
 * Event photo. A missing photo uses the tag placeholder. A photo that is still
 * downloading keeps a gray field with a light sweep, then fades in.
 */
export function EventImage({ imageUrl, tags, style }: Props) {
  const uri = imageUrl ? imageUri(imageUrl) : null;
  const reduced = useReducedMotion();
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = uri != null && failedUri === uri;
  const ready = uri != null && loadedUri === uri && !failed;
  const placeholder = placeholders[eventPlaceholderKind(tags)];
  const showPhoto = uri != null && !failed;

  return (
    <View style={[styles.frame, style]}>
      {showPhoto ? (
        <Image
          accessible={false}
          accessibilityIgnoresInvertColors
          recyclingKey={uri}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={reduced ? 0 : FADE_MS}
          onDisplay={() => setLoadedUri(uri)}
          onError={() => setFailedUri(uri)}
        />
      ) : (
        <Image
          accessible={false}
          accessibilityIgnoresInvertColors
          source={placeholder}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      )}
      {showPhoto && !ready ? <ImageSweep reduced={reduced ?? false} /> : null}
    </View>
  );
}

function ImageSweep({ reduced }: { reduced: boolean }) {
  return (
    <View pointerEvents="none" style={styles.sweepField}>
      {reduced ? null : (
        <Animated.View style={sweepStyle}>
          <View
            style={{
              flex: 1,
              experimental_backgroundImage:
                'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.72) 46%, rgba(255,255,255,0) 100%)',
            }}
          />
        </Animated.View>
      )}
    </View>
  );
}

/** Kept off StyleSheet so the keyframes stay a plain object Reanimated can read. */
const sweepStyle = {
  position: 'absolute' as const,
  top: 0,
  bottom: 0,
  width: '70%' as const,
  animationName: {
    from: { transform: [{ translateX: '-140%' }] },
    to: { transform: [{ translateX: '260%' }] },
  },
  animationDuration: `${SWEEP_MS}ms`,
  animationIterationCount: 'infinite' as const,
  animationTimingFunction: 'linear' as const,
};

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: LOADING_SURFACE,
  },
  sweepField: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    backgroundColor: LOADING_SURFACE,
  },
});
