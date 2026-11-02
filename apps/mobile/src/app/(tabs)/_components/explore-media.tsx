import { requireOptionalNativeModule } from 'expo';
import { useEffect, useState, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { ImageFocal } from '@local-events/domain';

import { EventImage } from '@/components/ui/event-image';

type PlayerProps = { url: string };

type Props = {
  imageUrl?: string | null;
  focal?: ImageFocal | null;
  tags?: readonly string[];
  /** http(s) clip. The still stays up until the player is in this build. */
  videoUrl?: string | null;
  /** Only the visible card mounts a player. */
  active?: boolean;
};

function videoModuleInstalled(): boolean {
  try {
    return requireOptionalNativeModule('ExpoVideo') != null;
  } catch {
    return false;
  }
}

/** http(s) clip on an event, when the payload carries one. */
export function readEventVideoUrl(event: object): string | null {
  const value = (event as { videoUrl?: unknown }).videoUrl;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Full-bleed still, with a video player in the same frame when a clip exists
 * and this build includes expo-video. Reduced motion keeps the still.
 */
export function ExploreMedia({ imageUrl, focal, tags, videoUrl, active = false }: Props) {
  const reducedMotion = useReducedMotion();
  const [Player, setPlayer] = useState<ComponentType<PlayerProps> | null>(null);
  const canPlay = Boolean(videoUrl) && active && reducedMotion !== true && videoModuleInstalled();

  useEffect(() => {
    if (!canPlay) return;
    let cancelled = false;
    void import('./explore-video')
      .then((mod) => {
        if (!cancelled) setPlayer(() => mod.ExploreVideo);
      })
      .catch(() => {
        if (!cancelled) setPlayer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canPlay]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <EventImage imageUrl={imageUrl} focal={focal} tags={tags} style={StyleSheet.absoluteFill} />
      {canPlay && Player && videoUrl ? <Player url={videoUrl} /> : null}
    </View>
  );
}
