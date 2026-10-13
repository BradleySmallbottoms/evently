import { BottomSheet, Column, Host, Slider, Text } from '@expo/ui';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import {
  DISCOVERY_RADIUS_STOPS_M,
  resolveDiscoveryRadiusM,
} from '@/lib/discovery-radius';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export type LocationMenuOption = {
  id: string;
  label: string;
};

type Props = {
  eyebrow?: string;
  locationLabel: string;
  title: string;
  message: string;
  options: LocationMenuOption[];
  /** Search radius in meters. The sheet slider changes this. */
  radiusM: number;
  onRadiusChange: (radiusM: number) => void;
  isPresented?: boolean;
  onIsPresentedChange?: (open: boolean) => void;
  onSelect: (id: string) => void;
};

const STOPS_KM = DISCOVERY_RADIUS_STOPS_M.map((meters) => meters / 1_000);
const LAST_INDEX = STOPS_KM.length - 1;

function indexForMeters(meters: number): number {
  const snapped = resolveDiscoveryRadiusM(meters);
  const index = DISCOVERY_RADIUS_STOPS_M.indexOf(snapped);
  return index === -1 ? 0 : index;
}

export function LocationMenu({
  eyebrow,
  locationLabel,
  title,
  message,
  options,
  radiusM,
  onRadiusChange,
  isPresented,
  onIsPresentedChange,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isPresented ?? uncontrolledOpen;
  const [radiusIndex, setRadiusIndex] = useState(() => indexForMeters(radiusM));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setOpen(next: boolean) {
    onIsPresentedChange?.(next);
    if (isPresented === undefined) setUncontrolledOpen(next);
  }

  useEffect(() => {
    if (saveTimer.current) return;
    setRadiusIndex(indexForMeters(radiusM));
  }, [radiusM]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

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
        <BottomSheet isPresented={open} onDismiss={() => setOpen(false)}>
          <Column spacing={12}>
            <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
            <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>{message}</Text>
            <View style={{ gap: space.xs }}>
              <View
                style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}
              >
                <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
                  {t('events.searchRadius')}
                </AppText>
                <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
                  {t('preferences.radiusKm', { km: STOPS_KM[radiusIndex] })}
                </AppText>
              </View>
              <AppText variant="caption">{t('events.searchRadiusHint')}</AppText>
              <Host style={{ width: '100%', minHeight: 44 }}>
                <Slider
                  value={radiusIndex}
                  min={0}
                  max={LAST_INDEX}
                  step={1}
                  onValueChange={(next) => {
                    const snapped = Math.min(LAST_INDEX, Math.max(0, Math.round(next)));
                    setRadiusIndex(snapped);
                    if (saveTimer.current) clearTimeout(saveTimer.current);
                    saveTimer.current = setTimeout(() => {
                      saveTimer.current = null;
                      onRadiusChange(DISCOVERY_RADIUS_STOPS_M[snapped] ?? DISCOVERY_RADIUS_STOPS_M[0]);
                    }, 400);
                  }}
                />
              </Host>
            </View>
            <View style={{ gap: space.sm }}>
              {options.map((option, index) => (
                <PrimaryButton
                  key={option.id}
                  label={option.label}
                  onPress={() => {
                    setOpen(false);
                    onSelect(option.id);
                  }}
                  style={index === 0 ? undefined : { backgroundColor: colors.ink }}
                />
              ))}
            </View>
          </Column>
        </BottomSheet>
      </Host>
    </>
  );
}
