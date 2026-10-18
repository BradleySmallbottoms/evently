import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { EventImage } from '@/components/ui/event-image';
import { heroImageUrls } from '@/lib/hero-images';
import { radius, space } from '@/theme/tokens';

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
        style={{ position: 'absolute', left: space.lg, bottom: 64 }}
      >
        <View
          style={{
            borderRadius: radius.pill,
            backgroundColor: 'rgba(17,24,32,0.55)',
            paddingHorizontal: space.sm,
            paddingVertical: 4,
          }}
        >
          <AppText style={{ color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontWeight: '700' }}>
            {page + 1}/{urls.length}
          </AppText>
        </View>
      </View>
    </View>
  );
}
