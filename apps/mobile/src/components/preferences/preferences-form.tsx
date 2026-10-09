import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { api, throwIfError } from '@/lib/api';
import { resolveEventQueryPoint } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import {
  createCircleArea,
  getPreferences,
  replaceInterests,
  updateCircleArea,
  updateQuietHours,
} from '@/lib/preferences';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const RADIUS_PRESETS = [5_000, 15_000, 50_000] as const;
const DEFAULT_QUIET_START = 22 * 60;
const DEFAULT_QUIET_END = 8 * 60;

export function PreferencesForm() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [radiusM, setRadiusM] = useState<(typeof RADIUS_PRESETS)[number]>(15_000);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => throwIfError(await api.GET('/categories')),
  });

  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
  });

  useEffect(() => {
    if (!preferences.data || hydrated) return;
    setSelected(new Set(preferences.data.categoryIds));
    const circle = preferences.data.areas.find((a) => a.radiusM != null);
    if (circle?.radiusM && RADIUS_PRESETS.includes(circle.radiusM as (typeof RADIUS_PRESETS)[number])) {
      setRadiusM(circle.radiusM as (typeof RADIUS_PRESETS)[number]);
    }
    setQuietHoursEnabled(preferences.data.quietHours.enabled);
    setHydrated(true);
  }, [preferences.data, hydrated]);

  const save = useMutation({
    mutationFn: async () => {
      const id = identity.data;
      if (!id) throw new Error('missing_identity');
      await replaceInterests(id, [...selected]);
      await updateQuietHours(id, {
        enabled: quietHoursEnabled,
        startMin: DEFAULT_QUIET_START,
        endMin: DEFAULT_QUIET_END,
      });
      const point = await resolveEventQueryPoint();
      const existingCircle = preferences.data?.areas.find((a) => a.center && a.radiusM != null);
      if (existingCircle) {
        await updateCircleArea(id, existingCircle.id, {
          lat: existingCircle.center?.lat ?? point.lat,
          lng: existingCircle.center?.lng ?? point.lng,
          radiusM,
        });
      } else {
        await createCircleArea(id, {
          name: t('preferences.defaultAreaName'),
          lat: point.lat,
          lng: point.lng,
          radiusM,
        });
      }
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
      await queryClient.invalidateQueries({ queryKey: ['event-query-point'] });
      router.back();
    },
    onError: () => setError(t('preferences.saveError')),
  });

  const categoryItems = categories.data?.items ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl, paddingBottom: space.xxxl }}>
      <View style={{ gap: space.sm }}>
        <AppText variant="hero">{t('preferences.title')}</AppText>
        <AppText variant="caption">{t('preferences.subtitle')}</AppText>
      </View>

      <View style={{ gap: space.md }}>
        <AppText variant="subtitle">{t('preferences.interestsTitle')}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {categoryItems.map((cat) => {
            const on = selected.has(cat.id);
            const label = locale === 'en' ? cat.nameEn : cat.nameSv;
            return (
              <Pressable
                key={cat.id}
                onPress={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(cat.id)) next.delete(cat.id);
                    else next.add(cat.id);
                    return next;
                  });
                }}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm + 2,
                  borderRadius: radius.pill,
                  borderCurve: 'continuous',
                  backgroundColor: on ? colors.accent : (colors.card as string),
                  borderWidth: on ? 0 : 1,
                  borderColor: colors.line,
                }}
              >
                <AppText
                  variant="label"
                  style={{ color: on ? '#FFFFFF' : colors.ink, fontWeight: '600' }}
                >
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <AppText variant="subtitle">{t('preferences.areaTitle')}</AppText>
        <AppText variant="caption">{t('preferences.areaHint')}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {RADIUS_PRESETS.map((r) => {
            const on = radiusM === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRadiusM(r)}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm + 2,
                  borderRadius: radius.pill,
                  borderCurve: 'continuous',
                  backgroundColor: on ? colors.accent : (colors.card as string),
                  borderWidth: on ? 0 : 1,
                  borderColor: colors.line,
                }}
              >
                <AppText
                  variant="label"
                  style={{ color: on ? '#FFFFFF' : colors.ink, fontWeight: '600' }}
                >
                  {t('preferences.radiusKm', { km: r / 1000 })}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <AppText variant="subtitle">{t('preferences.quietHoursTitle')}</AppText>
        <AppText variant="caption">{t('preferences.quietHoursHint')}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(
            [
              { on: true, label: t('preferences.quietHoursOn') },
              { on: false, label: t('preferences.quietHoursOff') },
            ] as const
          ).map((opt) => {
            const selectedOpt = quietHoursEnabled === opt.on;
            return (
              <Pressable
                key={opt.label}
                onPress={() => setQuietHoursEnabled(opt.on)}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm + 2,
                  borderRadius: radius.pill,
                  borderCurve: 'continuous',
                  backgroundColor: selectedOpt ? colors.accent : (colors.card as string),
                  borderWidth: selectedOpt ? 0 : 1,
                  borderColor: colors.line,
                }}
              >
                <AppText
                  variant="label"
                  style={{ color: selectedOpt ? '#FFFFFF' : colors.ink, fontWeight: '600' }}
                >
                  {opt.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error && (
        <AppText variant="caption" style={{ color: colors.danger }}>
          {error}
        </AppText>
      )}

      <PrimaryButton
        label={t('preferences.save')}
        loading={save.isPending}
        disabled={selected.size === 0 || identity.isPending || categories.isPending}
        onPress={() => save.mutate()}
      />
    </ScrollView>
  );
}
