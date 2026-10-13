import { Host, Slider } from '@expo/ui';
import { TRAVEL_DISTANCE_STOPS_M, resolveTravelDistanceM } from '@local-events/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  value: number;
  disabled: boolean;
  onChange: (distanceM: number) => void;
};

const STOPS_KM = TRAVEL_DISTANCE_STOPS_M.map((meters) => meters / 1_000);
const LAST_INDEX = STOPS_KM.length - 1;

function indexForMeters(meters: number): number {
  const km = resolveTravelDistanceM(meters) / 1_000;
  const index = STOPS_KM.indexOf(km);
  return index === -1 ? 0 : index;
}

/** Profile control for how far someone can go before a new place is suggested. */
export function TravelDistanceSetting({ value, disabled, onChange }: Props) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(() => indexForMeters(value));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveTimer.current) return;
    setIndex(indexForMeters(value));
  }, [value]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <AppText variant="subtitle">{t('preferences.travelDistanceTitle')}</AppText>
        <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
          {t('preferences.radiusKm', { km: STOPS_KM[index] })}
        </AppText>
      </View>
      <AppText variant="caption">{t('preferences.travelDistanceHint')}</AppText>
      <Host style={{ width: '100%', minHeight: 44 }}>
        <Slider
          value={index}
          min={0}
          max={LAST_INDEX}
          step={1}
          disabled={disabled}
          onValueChange={(next) => {
            const snapped = Math.min(LAST_INDEX, Math.max(0, Math.round(next)));
            setIndex(snapped);
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => {
              saveTimer.current = null;
              onChange(TRAVEL_DISTANCE_STOPS_M[snapped] ?? TRAVEL_DISTANCE_STOPS_M[0]);
            }, 400);
          }}
        />
      </Host>
    </View>
  );
}
