import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, View } from 'react-native';

import { EventImage } from '@/components/ui/event-image';
import { heroImageUrls } from '@/lib/hero-images';
import { radius } from '@/theme/tokens';

type Props = {
  imageUrl?: string | null;
  imageUrls?: readonly string[];
  tags?: readonly string[];
};

export function EventHeroGallery({ imageUrl, imageUrls, tags }: Props) {
  const { t } = useTranslation();
  const urls = heroImageUrls(imageUrl, imageUrls);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [index, setIndex] = useState(0);

  if (urls.length < 2) {
    return <EventImage imageUrl={urls[0] ?? null} tags={tags} />;
  }

  const page = Math.min(index, urls.length - 1);

  return (
    <View
      style={{ flex: 1 }}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0 && (width !== frame.width || height !== frame.height)) {
          setFrame({ width, height });
        }
      }}
    >
      {frame.width > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          nestedScrollEnabled
          directionalLockEnabled
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / frame.width);
            const clamped = Math.max(0, Math.min(urls.length - 1, next));
            if (clamped === page) return;
            setIndex(clamped);
            if (Platform.OS === 'ios') void Haptics.selectionAsync();
          }}
          style={{ flex: 1 }}
        >
          {urls.map((url, imageIndex) => (
            <View
              key={url}
              accessible
              accessibilityLabel={t('events.galleryPosition', {
                current: imageIndex + 1,
                total: urls.length,
              })}
              style={{ width: frame.width, height: frame.height }}
            >
              <EventImage imageUrl={url} tags={tags} />
            </View>
          ))}
        </ScrollView>
      ) : (
        <EventImage imageUrl={urls[0]} tags={tags} />
      )}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 96,
          alignItems: 'center',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingHorizontal: 8,
            paddingVertical: 6,
            borderRadius: radius.pill,
            backgroundColor: 'rgba(20,20,20,0.35)',
          }}
        >
          {urls.map((url, dot) => (
            <View
              key={url}
              style={{
                width: dot === page ? 16 : 6,
                height: 6,
                borderRadius: radius.pill,
                backgroundColor: dot === page ? '#FFFFFF' : 'rgba(255,255,255,0.45)',
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
