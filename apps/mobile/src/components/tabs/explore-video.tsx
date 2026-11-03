import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';

/** Muted looping clip. Mounted only for the card that is on screen. */
export function ExploreVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (next) => {
    next.loop = true;
    next.muted = true;
    next.play();
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}
