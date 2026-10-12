import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { listTags } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import { getPreferences, replaceInterests } from '@/lib/preferences';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export default function FavoriteCategoriesScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: listTags,
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
  });

  useEffect(() => {
    if (!preferences.data || hydrated) return;
    setSelected(new Set(preferences.data.tagIds));
    setHydrated(true);
  }, [preferences.data, hydrated]);

  const save = useMutation({
    mutationFn: async () => {
      const id = identity.data;
      if (!id) throw new Error('missing_identity');
      await replaceInterests(id, [...selected]);
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
      router.back();
    },
    onError: () => setError(t('preferences.saveError')),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={{ paddingHorizontal: space.xl, paddingVertical: space.md }}
      >
        <AppText variant="label" style={{ color: colors.accent }}>
          {t('preferences.back')}
        </AppText>
      </Pressable>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.xl, gap: space.xl, paddingBottom: space.xxxl }}
      >
        <View style={{ gap: space.sm }}>
          <AppText variant="title">{t('profile.categories')}</AppText>
          <AppText variant="caption">{t('profile.categoriesHint')}</AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(tags.data?.items ?? []).map((tag) => {
            const on = selected.has(tag.id);
            const label = tag.name;
            return (
              <Pressable
                key={tag.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(tag.id)) next.delete(tag.id);
                    else next.add(tag.id);
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
                <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        {error ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {error}
          </AppText>
        ) : null}
        <PrimaryButton
          label={t('preferences.save')}
          loading={save.isPending}
          disabled={!identity.data || tags.isPending || !hydrated}
          onPress={() => save.mutate()}
        />
      </ScrollView>
    </View>
  );
}
