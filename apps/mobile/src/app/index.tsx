import { useQuery } from '@tanstack/react-query';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { ensureIdentity } from '@/lib/identity';

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.heroSection}>
          <ThemedText type="title" style={styles.title}>
            {t('home.title')}
          </ThemedText>
          <ThemedText style={styles.subtitle}>{t('home.subtitle')}</ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.statusCard}>
          {identity.isPending && <ThemedText type="small">{t('home.identityLoading')}</ThemedText>}
          {identity.isError && <ThemedText type="small">{t('home.identityError')}</ThemedText>}
          {identity.isSuccess && (
            <>
              <ThemedText type="smallBold">{t('home.identityReady')}</ThemedText>
              <ThemedText type="small">
                {t('home.userId')}: {identity.data.userId}
              </ThemedText>
            </>
          )}
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    opacity: 0.8,
  },
  statusCard: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
});
