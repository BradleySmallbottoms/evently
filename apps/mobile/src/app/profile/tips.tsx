import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { TipChrome } from '@/components/ui/tip-chrome';
import { ensureIdentity } from '@/lib/identity';
import { listTips } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export default function MyTipsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const tips = useQuery({
    queryKey: ['tips', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listTips(identity.data!),
  });

  return (
    <TipChrome title={t('tips.mine')}>
      {tips.isPending ? <ActivityIndicator color={colors.ink} /> : null}
      {tips.isError ? <AppText style={{ color: colors.danger }}>{t('tips.error')}</AppText> : null}
      {tips.data?.items.length === 0 ? (
        <AppText variant="body" style={{ color: colors.inkMuted }}>
          {t('tips.empty')}
        </AppText>
      ) : null}
      {(tips.data?.items ?? []).map((tip) => {
        const title = tip.found?.title ?? tip.card?.title ?? t('tips.fallbackTitle');
        return (
          <Pressable
            key={tip.id}
            accessibilityRole="button"
            onPress={() => router.push(`/tips/${tip.id}`)}
            style={{
              backgroundColor: colors.card,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.line,
              padding: space.lg,
              gap: 4,
            }}
          >
            <AppText variant="label">{title}</AppText>
            <AppText variant="caption" style={{ color: colors.inkMuted }}>
              {t(`tips.phase.${tip.phase}`)}
            </AppText>
          </Pressable>
        );
      })}
    </TipChrome>
  );
}
