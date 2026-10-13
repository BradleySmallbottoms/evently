import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TagGroupList } from '@/components/ui/tag-group-list';
import { listTags } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import { getPreferences, replaceInterests } from '@/lib/preferences';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

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
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md }}>
        <BackPill />
      </View>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.xl, gap: space.xl, paddingBottom: space.xxxl }}
      >
        <View style={{ gap: space.sm }}>
          <AppText variant="title">{t('profile.categories')}</AppText>
          <AppText variant="caption">{t('profile.categoriesHint')}</AppText>
        </View>
        {tags.isPending ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <TagGroupList
            tags={tags.data?.items ?? []}
            selectedIds={[...selected]}
            showHeading={false}
            onChange={(ids) => setSelected(new Set(ids))}
          />
        )}
        {error ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {error}
          </AppText>
        ) : null}
        <PrimaryButton
          label={t('preferences.save')}
          loading={save.isPending}
          disabled={!identity.data || tags.isPending || tags.isError || !hydrated}
          onPress={() => save.mutate()}
        />
      </ScrollView>
    </View>
  );
}
