import { deviceAssetUrl } from '@local-events/domain';
import { Image, type ImageProps } from 'expo-image';
import { Platform } from 'react-native';

import { API_URL } from '@/lib/api';
import { eventPlaceholderKind, type EventPlaceholderKind } from '@/lib/event-placeholder';

const placeholders: Record<EventPlaceholderKind, number> = {
  music: require('@/assets/images/placeholder-music.png'),
  workout: require('@/assets/images/placeholder-workout.png'),
  lecture: require('@/assets/images/placeholder-lecture.png'),
  culture: require('@/assets/images/placeholder-culture.png'),
  generic: require('@/assets/images/placeholder-generic.png'),
};

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

export function EventImage({ imageUrl, tags, style }: Props) {
  const placeholder = placeholders[eventPlaceholderKind(tags)];
  return (
    <Image
      source={imageUrl ? { uri: imageUri(imageUrl) } : placeholder}
      placeholder={placeholder}
      style={style ?? { width: '100%', height: '100%' }}
      contentFit="cover"
    />
  );
}
