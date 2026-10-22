import { ApiError } from '@local-events/api-client';
import { BottomSheet, Host, Slider } from '@expo/ui';
import { MenuView } from '@expo/ui/community/menu';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PlaceSearchField } from '@/components/ui/place-search-field';
import type { NamedPlace } from '@/lib/place-lookup';
import { DISCOVERY_RADIUS_STOPS_M, resolveDiscoveryRadiusM } from '@/lib/discovery-radius';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { accentSliderTint, locationSheetFrame } from './location-menu-modifiers';
import { SheetBody } from './sheet-body';

export type LocationMenuOption = {
  id: string;
  label: string;
};

type Props = {
  eyebrow?: string;
  locationLabel: string;
  title: string;
  message: string;
  /** First option is “near me”. The rest are saved places. */
  options: LocationMenuOption[];
  selectedId?: string;
  /** Search radius in meters for the place already in use. */
  radiusM: number;
  /** Remembered search radius for each option, including “near me”. */
  radiusByPlace?: Record<string, number>;
  /** Applied for the confirmed place when the sheet closes. */
  onRadiusChange: (radiusM: number, placeId: string) => void;
  isPresented?: boolean;
  onIsPresentedChange?: (open: boolean) => void;
  onSelect: (id: string) => void;
  /** False when the saved-area cap is already reached. */
  canAdd?: boolean;
  /** Saves a typed place. The caller then asks for category groups. */
  onCreatePlace?: (place: NamedPlace) => Promise<void>;
  /** Draft place and radius, so the caller can count that combination. */
  onDraftChange?: (draft: { placeId: string; radiusM: number }) => void;
  /** Events the draft place and radius will show. Omitted until the count arrives. */
  eventCount?: number;
};

const STOPS_KM = DISCOVERY_RADIUS_STOPS_M.map((meters) => meters / 1_000);
const LAST_INDEX = STOPS_KM.length - 1;

function indexForMeters(meters: number): number {
  const snapped = resolveDiscoveryRadiusM(meters);
  const index = DISCOVERY_RADIUS_STOPS_M.indexOf(snapped);
  return index === -1 ? 0 : index;
}

function Glyph({
  sf,
  md,
  color,
  size = 18,
}: {
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  color: string;
  size?: number;
}) {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={sf as never} size={size} tintColor={color} />;
  }
  return <MaterialIcons name={md} size={size + 2} color={color} />;
}

export function LocationMenu({
  eyebrow,
  locationLabel,
  title,
  message,
  options,
  selectedId,
  radiusM,
  radiusByPlace,
  onRadiusChange,
  isPresented,
  onIsPresentedChange,
  onSelect,
  canAdd = true,
  onCreatePlace,
  onDraftChange,
  eventCount,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  // The sheet reports its own width as the window, so sizing from that and then
  // subtracting padding settles short of the screen. Use the screen width.
  const screenWidth = Dimensions.get('screen').width;
  const contentWidth = screenWidth - space.xl * 2;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isPresented ?? uncontrolledOpen;
  const nearby = options[0];
  const savedOptions = options.slice(1);
  const [draftId, setDraftId] = useState(selectedId ?? nearby?.id ?? '');
  const [savedId, setSavedId] = useState(savedOptions[0]?.id ?? '');
  const [radiusIndex, setRadiusIndex] = useState(() => indexForMeters(radiusM));
  const [menuWidth, setMenuWidth] = useState(0);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const wasOpen = useRef(false);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  useEffect(() => {
    if (!open) return;
    const meters = DISCOVERY_RADIUS_STOPS_M[radiusIndex] ?? DISCOVERY_RADIUS_STOPS_M[0];
    onDraftChangeRef.current?.({ placeId: draftId, radiusM: meters });
  }, [draftId, open, radiusIndex]);

  function setOpen(next: boolean) {
    onIsPresentedChange?.(next);
    if (isPresented === undefined) setUncontrolledOpen(next);
  }

  useEffect(() => {
    if (open && !wasOpen.current) {
      const nearbyId = options[0]?.id ?? '';
      const saved = options.slice(1);
      const current =
        selectedId && options.some((option) => option.id === selectedId) ? selectedId : nearbyId;
      setDraftId(current);
      setSavedId(saved.some((option) => option.id === current) ? current : (saved[0]?.id ?? ''));
      setRadiusIndex(indexForMeters(radiusByPlace?.[current] ?? radiusM));
      setAdding(false);
      setCreateError(null);
    }
    wasOpen.current = open;
  }, [open, options, radiusByPlace, radiusM, selectedId]);

  const nearbySelected = draftId === nearby?.id;
  const savedLabel =
    savedOptions.find((option) => option.id === savedId)?.label ?? t('events.savedPlacesEmpty');

  function choosePlace(id: string) {
    setDraftId(id);
    const remembered = radiusByPlace?.[id];
    if (remembered != null) setRadiusIndex(indexForMeters(remembered));
  }

  function showEvents() {
    const meters = DISCOVERY_RADIUS_STOPS_M[radiusIndex] ?? DISCOVERY_RADIUS_STOPS_M[0];
    if (draftId) {
      onRadiusChange(meters, draftId);
      onSelect(draftId);
    }
    setOpen(false);
  }

  async function pickNewPlace(place: NamedPlace) {
    if (!onCreatePlace || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreatePlace(place);
      setAdding(false);
      setOpen(false);
    } catch (err) {
      const limited = err instanceof ApiError && err.code === 'area_limit';
      setCreateError(limited ? t('events.areaLimit') : t('events.areaSaveError'));
    } finally {
      setCreating(false);
    }
  }

  function managePlaces() {
    setOpen(false);
    router.push('/profile/areas');
  }

  const savedField = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        backgroundColor: colors.card,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
      }}
    >
      <AppText variant="body" numberOfLines={1} style={{ flex: 1, color: colors.ink }}>
        {savedLabel}
      </AppText>
      <Glyph sf="chevron.down" md="expand-more" color={colors.inkMuted as string} size={14} />
    </View>
  );

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{ flexShrink: 1, minWidth: 0, maxWidth: '100%' }}
      >
        <View style={{ gap: eyebrow ? 2 : 0, maxWidth: '100%' }}>
          {eyebrow ? (
            <AppText variant="caption" numberOfLines={1}>
              {eyebrow}
            </AppText>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <MaterialIcons name="my-location" size={16} color={colors.ink} />
            <AppText variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
              {locationLabel}
            </AppText>
            <MaterialIcons name="expand-more" size={16} color={colors.inkMuted} />
          </View>
        </View>
      </Pressable>
      <Host style={{ position: 'absolute', width: 0, height: 0 }}>
        <BottomSheet
          isPresented={open}
          onDismiss={() => setOpen(false)}
          snapPoints={[{ fraction: 0.82 }]}
          containerColor={colors.card}
          contentPadding={{ top: space.lg, bottom: space.lg, left: space.xl, right: space.xl }}
          modifiers={locationSheetFrame(screenWidth)}
        >
          <SheetBody>
            <View style={{ gap: space.lg, width: contentWidth }}>
              <View style={{ gap: space.xs }}>
                <AppText variant="title">{title}</AppText>
                <AppText variant="body" style={{ color: colors.inkMuted }}>
                  {message}
                </AppText>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: nearbySelected }}
                onPress={() => {
                  if (nearby) choosePlace(nearby.id);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  padding: space.lg,
                  borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  borderWidth: 1.5,
                  borderColor: nearbySelected ? colors.accent : colors.line,
                  backgroundColor: nearbySelected ? colors.accentSoft : colors.card,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: nearbySelected ? colors.accent : colors.accentSoft,
                  }}
                >
                  <Glyph
                    sf="location.north.line.fill"
                    md="near-me"
                    color={
                      nearbySelected ? (colors.accentSoft as string) : (colors.accent as string)
                    }
                  />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="subtitle">{t('events.locationNearMe')}</AppText>
                  <AppText variant="caption">{t('events.locationNearMeHint')}</AppText>
                </View>
                {nearbySelected ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: colors.card,
                      borderRadius: radius.pill,
                      paddingHorizontal: space.sm,
                      paddingVertical: 4,
                    }}
                  >
                    <Glyph sf="checkmark" md="check" color={colors.accent as string} size={12} />
                    <AppText variant="label" style={{ color: colors.accent, fontWeight: '700' }}>
                      {t('events.locationCurrent')}
                    </AppText>
                  </View>
                ) : null}
              </Pressable>

              <View
                style={{
                  gap: space.md,
                  padding: space.lg,
                  borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  borderWidth: 1,
                  borderColor: nearbySelected ? colors.line : colors.secondarySoft,
                  backgroundColor: nearbySelected ? colors.card : colors.secondarySoft,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    const firstSaved = savedOptions[0]?.id;
                    if (!firstSaved) return;
                    setSavedId(firstSaved);
                    choosePlace(firstSaved);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    opacity: savedOptions.length > 0 ? 1 : 0.5,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: nearbySelected ? colors.secondarySoft : colors.secondary,
                    }}
                  >
                    <Glyph
                      sf="mappin"
                      md="place"
                      color={
                        nearbySelected
                          ? (colors.secondary as string)
                          : (colors.secondarySoft as string)
                      }
                    />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="subtitle">{t('events.savedPlaces')}</AppText>
                    <AppText variant="caption">{t('events.savedPlacesHint')}</AppText>
                  </View>
                  {!nearbySelected ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor: colors.card,
                        borderRadius: radius.pill,
                        paddingHorizontal: space.sm,
                        paddingVertical: 4,
                      }}
                    >
                      <Glyph
                        sf="checkmark"
                        md="check"
                        color={colors.secondary as string}
                        size={12}
                      />
                      <AppText
                        variant="label"
                        style={{ color: colors.secondary, fontWeight: '700' }}
                      >
                        {t('events.locationCurrent')}
                      </AppText>
                    </View>
                  ) : null}
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    {adding ? (
                      <PlaceSearchField
                        autoFocus
                        editable={!creating}
                        onPick={(place) => {
                          void pickNewPlace(place);
                        }}
                      />
                    ) : savedOptions.length > 0 ? (
                      <View
                        style={{ alignSelf: 'stretch' }}
                        onLayout={(event) => {
                          const next = Math.round(event.nativeEvent.layout.width);
                          setMenuWidth((current) => (current === next ? current : next));
                        }}
                      >
                        <MenuView
                          style={menuWidth > 0 ? { width: menuWidth } : undefined}
                          actions={savedOptions.map((option) => ({
                            id: option.id,
                            title: option.label,
                            state: option.id === savedId ? 'on' : 'off',
                          }))}
                          onPressAction={({ nativeEvent }) => {
                            setSavedId(nativeEvent.event);
                            choosePlace(nativeEvent.event);
                          }}
                        >
                          <View
                            accessibilityRole="button"
                            accessibilityLabel={savedLabel}
                            style={menuWidth > 0 ? { width: menuWidth } : undefined}
                          >
                            {savedField}
                          </View>
                        </MenuView>
                      </View>
                    ) : (
                      savedField
                    )}
                    {createError ? (
                      <AppText
                        variant="caption"
                        style={{ color: colors.danger, marginTop: space.xs }}
                      >
                        {createError}
                      </AppText>
                    ) : null}
                  </View>
                  {onCreatePlace ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        adding ? t('events.cancelAddPlace') : t('events.addSavedPlace')
                      }
                      disabled={creating || (!canAdd && !adding)}
                      onPress={() => {
                        setCreateError(null);
                        setAdding((current) => !current);
                      }}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: radius.pill,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: nearbySelected ? colors.accent : colors.secondarySoftAlpha,
                        opacity: creating || (!canAdd && !adding) ? 0.4 : 1,
                      }}
                    >
                      <Glyph
                        sf={adding ? 'xmark' : 'plus'}
                        md={adding ? 'close' : 'add'}
                        color={
                          nearbySelected
                            ? (colors.accent as string)
                            : (colors.secondarySoft as string)
                        }
                      />
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <View
                style={{
                  gap: space.sm,
                  padding: space.lg,
                  borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.card,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                  }}
                >
                  <AppText variant="subtitle">{t('events.searchRadius')}</AppText>
                  <AppText variant="subtitle" style={{ fontWeight: '700' }}>
                    {t('preferences.radiusKm', { km: STOPS_KM[radiusIndex] })}
                  </AppText>
                </View>
                <AppText variant="caption">{t('events.searchRadiusHint')}</AppText>
                <Host style={{ width: contentWidth - space.lg * 2, height: 36 }}>
                  <Slider
                    value={radiusIndex}
                    min={0}
                    max={LAST_INDEX}
                    step={1}
                    modifiers={accentSliderTint()}
                    onValueChange={(next) => {
                      const snapped = Math.min(LAST_INDEX, Math.max(0, Math.round(next)));
                      setRadiusIndex(snapped);
                    }}
                  />
                </Host>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <AppText variant="caption">{t('preferences.radiusKm', { km: 0 })}</AppText>
                  <AppText variant="caption">{t('preferences.radiusKm', { km: 100 })}</AppText>
                </View>
              </View>

              <Pressable accessibilityRole="button" onPress={showEvents}>
                {({ pressed }) => (
                  <View
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: radius.lg,
                      borderCurve: 'continuous',
                      minHeight: 52,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.9 : 1,
                    }}
                  >
                    <AppText variant="subtitle" style={{ color: colors.card, fontWeight: '700' }}>
                      {eventCount == null
                        ? t('events.showEvents')
                        : t('events.showEventsCount', { count: eventCount })}
                    </AppText>
                  </View>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={managePlaces}
                style={{ alignItems: 'center' }}
              >
                <AppText
                  variant="caption"
                  style={{ color: colors.inkMuted, textDecorationLine: 'underline' }}
                >
                  {t('events.managePlaces')}
                </AppText>
              </Pressable>
            </View>
          </SheetBody>
        </BottomSheet>
      </Host>
    </>
  );
}
