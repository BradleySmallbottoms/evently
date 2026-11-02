import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ImageFocal } from '@local-events/domain';

import { AppText } from '@/components/ui/app-text';
import { BottomTabInset } from '@/constants/theme';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { ExploreMedia } from './explore-media';
import { dropShadow, width } from '@expo/ui/jetpack-compose/modifiers';

type Props = {
  title: string;
  when: string;
  where: string;
  tags: string[];
  imageUrl?: string | null;
  focal?: ImageFocal | null;
  videoUrl?: string | null;
  saved: boolean;
  interestCount: number;
  active: boolean;
  height: number;
  onOpen: () => void;
  onSave: () => void;
  onCalendar: () => void;
  onShare: () => void;
};

function tap() {
  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
}

function Glyph({
  sf,
  md,
  color = '#FFFFFF',
  size = 26,
}: {
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  color?: string;
  size?: number;
}) {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={sf as never} size={size} tintColor={color} />;
  }
  return <MaterialIcons name={md} size={size} color={color} />;
}

function RailButton({
  label,
  accessibilityLabel,
  selected,
  onPress,
  children,
}: {
  label?: string;
  accessibilityLabel: string;
  selected?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={{
        minWidth: 64,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      {children}
      {label ? (
        <AppText
          variant="label"
          style={{ color: '#FFFFFF', fontSize: 11, lineHeight: 14, textAlign: 'center' }}
        >
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export function ExploreCard({
  title,
  when,
  where,
  tags,
  imageUrl,
  focal,
  videoUrl,
  saved,
  interestCount,
  active,
  height,
  onOpen,
  onSave,
  onCalendar,
  onShare,
}: Props) {
  const { t } = useTranslation();
  const shownTags = tags.slice(0, 2);
  const countLabel = t('explore.interested', { count: interestCount });

  return (
    <View style={{ height, backgroundColor: colors.overlay }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onOpen}
        style={StyleSheet.absoluteFill}
      >
        <ExploreMedia
          imageUrl={imageUrl}
          focal={focal}
          tags={tags}
          videoUrl={videoUrl}
          active={active}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: 180,
            experimental_backgroundImage:
              'linear-gradient(to bottom, rgba(17,24,32,0.55) 0%, rgba(17,24,32,0) 100%)',
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 280,
            experimental_backgroundImage:
              'linear-gradient(to bottom, rgba(17,24,32,0) 0%, rgba(17,24,32,0.88) 70%)',
          }}
        />
      </Pressable>

      <View
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          left: 0,
          paddingBottom: BottomTabInset + space.xl,
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: space.lg,
          backgroundColor: 'rgba(0,0,0,0.55)',
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          paddingLeft: space.lg,
          paddingVertical: space.lg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={onOpen}
          style={{ width: '80%', gap: space.sm, minWidth: 0 }}
        >
          <AppText
            style={{
              color: '#FFFFFF',
              fontSize: 13,
              lineHeight: 18,
              fontWeight: '700',
              letterSpacing: 0.4,
            }}
          >
            {when}
          </AppText>
          <AppText
            numberOfLines={3}
            style={{ color: '#FFFFFF', fontSize: 32, lineHeight: 36, fontWeight: '700' }}
          >
            {title}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Glyph sf="mappin" md="place" size={16} />
            <AppText numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 15, flexShrink: 1 }}>
              {where}
            </AppText>
          </View>
          {shownTags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {shownTags.map((tag) => (
                <View
                  key={tag}
                  style={{
                    borderRadius: radius.pill,
                    backgroundColor: 'rgba(255,255,255,0.16)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.35)',
                    paddingHorizontal: space.md,
                    paddingVertical: 4,
                  }}
                >
                  <AppText style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>
                    {tag}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>
        <View
          style={{
            width: 60,
            flexDirection: 'column',
            gap: space.sm,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RailButton accessibilityLabel={countLabel} selected={saved} onPress={onSave}>
            <Glyph
              sf={saved ? 'heart.fill' : 'heart'}
              md={saved ? 'favorite' : 'favorite-border'}
            />
            {/* <AppText
              style={{
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: '700',
                fontVariant: ['tabular-nums'],
              }}
            >
              {interestCount}
            </AppText> */}
          </RailButton>
          <RailButton
            // label={t('explore.add')}
            accessibilityLabel={t('events.detail.addToCalendar')}
            onPress={onCalendar}
          >
            <Glyph sf="calendar" md="event" />
          </RailButton>
          <RailButton
            // label={t('explore.save')}
            accessibilityLabel={saved ? t('explore.saved') : t('explore.save')}
            selected={saved}
            onPress={onSave}
          >
            <Glyph
              sf={saved ? 'bookmark.fill' : 'bookmark'}
              md={saved ? 'bookmark' : 'bookmark-border'}
            />
          </RailButton>
          <RailButton
            // label={t('explore.share')}
            accessibilityLabel={t('events.share')}
            onPress={onShare}
          >
            <Glyph sf="square.and.arrow.up" md="share" />
          </RailButton>
        </View>
      </View>
    </View>
  );
}
