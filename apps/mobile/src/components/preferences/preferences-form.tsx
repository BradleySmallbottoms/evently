import { AREA_RADIUS_PRESETS_M, DEFAULT_AREA_RADIUS_M } from '@local-events/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { listTags, resolveEventQueryPoint } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import {
  createCircleArea,
  getPreferences,
  replaceInterests,
  updateCircleArea,
} from '@/lib/preferences';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export function PreferencesForm() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [radiusM, setRadiusM] = useState<(typeof AREA_RADIUS_PRESETS_M)[number]>(DEFAULT_AREA_RADIUS_M);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });

  const tags = useQuery({
    queryKey: ['tags', 'all'],
    queryFn: () => listTags({ upcoming: false }),
  });

  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
  });

  useEffect(() => {
    if (!preferences.data || hydrated) return;
    setSelected(new Set(preferences.data.tagIds));
    const circle = preferences.data.areas.find((a) => a.radiusM != null);
    if (circle?.radiusM && AREA_RADIUS_PRESETS_M.includes(circle.radiusM as (typeof AREA_RADIUS_PRESETS_M)[number])) {
      setRadiusM(circle.radiusM as (typeof AREA_RADIUS_PRESETS_M)[number]);
    }
    setHydrated(true);
  }, [preferences.data, hydrated]);

  const save = useMutation({
    mutationFn: async () => {
      const id = identity.data;
      if (!id) throw new Error('missing_identity');
      await replaceInterests(id, [...selected]);
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

  const categoryItems = tags.data?.items ?? [];

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
            const label = cat.name;
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
                  style={{ color: colors.ink, fontWeight: '600' }}
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
          {AREA_RADIUS_PRESETS_M.map((r) => {
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
                  style={{ color: colors.ink, fontWeight: '600' }}
                >
                  {t('preferences.radiusKm', { km: r / 1000 })}
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
        disabled={selected.size === 0 || identity.isPending || tags.isPending}
        onPress={() => save.mutate()}
      />
    </ScrollView>
  );
}
