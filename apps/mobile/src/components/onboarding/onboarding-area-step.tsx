import { DEFAULT_AREA_RADIUS_M, AREA_RADIUS_PRESETS_M } from '@local-events/domain';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { readBalancedForegroundPosition } from '@/lib/events';
import { matchingPlace } from '@/lib/place-name';
import { placeNameAt, searchPlaces, type NamedPlace } from '@/lib/place-lookup';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  active: boolean;
  locationGranted: boolean;
  fallbackName: string;
  busy: boolean;
  onSave: (place: NamedPlace & { radiusM: number }) => void;
  onSkip: (detected: { lat: number; lng: number } | null) => void;
};

export function OnboardingAreaStep({
  active,
  locationGranted,
  fallbackName,
  busy,
  onSave,
  onSkip,
}: Props) {
  const { t } = useTranslation();
  const searchRequest = useRef(0);
  const [locateFailed, setLocateFailed] = useState(false);
  const [place, setPlace] = useState<NamedPlace | null>(null);
  const [detected, setDetected] = useState<{ lat: number; lng: number } | null>(null);
  const [text, setText] = useState('');
  const [results, setResults] = useState<NamedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchEmpty, setSearchEmpty] = useState(false);
  const [radiusM, setRadiusM] = useState<(typeof AREA_RADIUS_PRESETS_M)[number]>(DEFAULT_AREA_RADIUS_M);

  const locating = locationGranted && !locateFailed && !place;
  const textChanged =
    text.trim().toLocaleLowerCase('sv') !== (place?.name ?? '').trim().toLocaleLowerCase('sv');
  const resolved = textChanged ? matchingPlace(text, results) : place;

  useEffect(() => {
    if (!active || !locationGranted || place || locateFailed) return;
    let cancelled = false;
    void (async () => {
      try {
        const point = await readBalancedForegroundPosition();
        const name = (await placeNameAt(point.lat, point.lng)) ?? fallbackName;
        if (cancelled) return;
        setDetected({ lat: point.lat, lng: point.lng });
        setPlace({ name, lat: point.lat, lng: point.lng });
        setText(name);
      } catch {
        if (!cancelled) setLocateFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, locationGranted, place, locateFailed, fallbackName]);

  useEffect(() => {
    const requestId = ++searchRequest.current;
    const trimmed = text.trim();
    if (!textChanged || trimmed.length < 2) return;
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
  }, [text, textChanged]);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: space.sm, position: 'relative' }}>
        {locateFailed ? (
          <AppText variant="caption" style={{ color: '#FFFFFF', textAlign: 'center' }}>
            {t('onboarding.areaLocateFailed')}
          </AppText>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.card,
            borderRadius: radius.xl,
            borderCurve: 'continuous',
            minHeight: 48,
            gap: space.sm,
            paddingHorizontal: space.lg,
          }}
        >
          <SymbolView name={'location.fill' as never} size={18} tintColor={colors.ink} />
          <TextInput
            value={text}
            editable={!locating && !busy}
            onChangeText={(value) => {
              searchRequest.current += 1;
              setText(value);
              setResults([]);
              setSearchEmpty(false);
              setSearching(false);
            }}
            placeholder={
              locating ? t('onboarding.areaLocating') : t('onboarding.areaSearchPlaceholder')
            }
            placeholderTextColor={colors.inkFaint}
            returnKeyType="done"
            autoCorrect={false}
            style={{ flex: 1, fontSize: 16, color: colors.ink, paddingVertical: space.md }}
          />
          {text.length > 0 && !locating ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.areaSearchClear')}
              disabled={busy}
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
        {locating || searching ? <ActivityIndicator color="#FFFFFF" /> : null}

        {/* {textChanged && results.length > 0 ? ( */}
        <View
          style={{
            backgroundColor: colors.card,
            borderBottomLeftRadius: radius.xl,
            borderBottomRightRadius: radius.xl,
            borderCurve: 'continuous',
            overflow: 'hidden',
            position: 'absolute',
            top: '92%',
            left: 5,
            right: 5,
            zIndex: 1000,
          }}
        >
          {searchEmpty ? (
            <View style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: space.lg,
              borderTopWidth: 1,
              borderTopColor: 'rgba(26, 26, 26, 0.08)',
            }}>
              <AppText variant="caption" style={{ color: '#ff0000' }}>
                {t('onboarding.areaSearchEmpty')}
              </AppText>
            </View>
          ) : null}
          {results.map((result, index) => {
            const selected = matchingPlace(text, [result]) != null;
            return (
              <Pressable
                key={`${result.lat}:${result.lng}:${result.name}`}
                accessibilityRole="button"
                onPress={() => {
                  setPlace(result);
                  setText(result.name);
                  setResults([]);
                  setSearchEmpty(false);
                }}
                style={{
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: space.lg,
                  // backgroundColor: selected ? colors.accent : colors.card,
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(26, 26, 26, 0.08)',
                }}
              >
                <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
                  {result.name}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        {/* ) : null} */}
      </View>

      {place || resolved ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: space.sm,
            justifyContent: 'center',
          }}
        >
          {AREA_RADIUS_PRESETS_M.map((preset) => {
            const selected = radiusM === preset;
            return (
              <Pressable
                key={preset}
                accessibilityRole="button"
                onPress={() => setRadiusM(preset)}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm + 2,
                  borderRadius: radius.pill,
                  borderCurve: 'continuous',
                  backgroundColor: selected ? colors.accent : 'rgba(255,255,255,0.94)',
                }}
              >
                <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
                  {t('preferences.radiusKm', { km: preset / 1000 })}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <PrimaryButton
        label={t('onboarding.continue')}
        loading={busy}
        disabled={busy || locating || !resolved}
        onPress={() => {
          if (!resolved) return;
          onSave({ ...resolved, radiusM });
        }}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => onSkip(detected)}
        style={({ pressed }) => ({
          alignItems: 'center',
          paddingVertical: space.sm,
          opacity: busy ? 0.4 : pressed ? 0.6 : 1,
        })}
      >
        <AppText variant="caption" style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>
          {t('onboarding.skip')}
        </AppText>
      </Pressable>
    </View>
  );
}
