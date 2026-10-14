import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { searchPlaces, type NamedPlace } from '@/lib/place-lookup';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  onPick: (place: NamedPlace) => void;
  editable?: boolean;
  autoFocus?: boolean;
};

/** Place field used when saving an area. Same search as the onboarding area step. */
export function PlaceSearchField({ onPick, editable = true, autoFocus = false }: Props) {
  const { t } = useTranslation();
  const searchRequest = useRef(0);
  const [text, setText] = useState('');
  const [results, setResults] = useState<NamedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchEmpty, setSearchEmpty] = useState(false);

  useEffect(() => {
    const requestId = ++searchRequest.current;
    const trimmed = text.trim();
    if (trimmed.length < 2) return;
    const timer = setTimeout(() => {
      void (async () => {
        if (searchRequest.current !== requestId) return;
        setSearching(true);
        try {
          const found = await searchPlaces(trimmed);
          if (searchRequest.current !== requestId) return;
          setResults(found);
          setSearchEmpty(found.length === 0);
        } catch {
          if (searchRequest.current !== requestId) return;
          setResults([]);
          setSearchEmpty(true);
        } finally {
          if (searchRequest.current === requestId) setSearching(false);
        }
      })();
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  return (
    <View style={{ gap: space.xs, position: 'relative' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.card,
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.line,
          minHeight: 48,
          gap: space.sm,
          paddingHorizontal: space.lg,
        }}
      >
        <SymbolView name={'location.fill' as never} size={18} tintColor={colors.ink} />
        <TextInput
          value={text}
          editable={editable}
          autoFocus={autoFocus}
          onChangeText={(value) => {
            searchRequest.current += 1;
            setText(value);
            setResults([]);
            setSearchEmpty(false);
            setSearching(false);
          }}
          placeholder={t('onboarding.areaSearchPlaceholder')}
          placeholderTextColor={colors.inkFaint}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, fontSize: 16, color: colors.ink, paddingVertical: space.md }}
        />
        {searching ? <ActivityIndicator color={colors.ink} /> : null}
        {text.length > 0 && !searching ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.areaSearchClear')}
            hitSlop={8}
            onPress={() => {
              searchRequest.current += 1;
              setText('');
              setResults([]);
              setSearchEmpty(false);
              setSearching(false);
            }}
          >
            <SymbolView name={'xmark.circle.fill' as never} size={18} tintColor={colors.inkFaint} />
          </Pressable>
        ) : null}
      </View>
      {searchEmpty ? (
        <AppText variant="caption" style={{ color: colors.danger, paddingHorizontal: space.sm }}>
          {t('onboarding.areaSearchEmpty')}
        </AppText>
      ) : null}
      <View style={{
        borderBottomLeftRadius: radius.xl,
        borderBottomRightRadius: radius.xl,
        backgroundColor: colors.card,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.line,
        position: 'absolute',
        top: '98%',
        left: 8, 
        right: 8,
        zIndex: 1000,
      }}>
        {results.map((result) => (
          <Pressable
            key={`${result.lat}:${result.lng}:${result.name}`}
            accessibilityRole="button"
            onPress={() => onPick(result)}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: space.lg,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
              {result.name}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
