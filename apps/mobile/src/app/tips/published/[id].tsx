import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { getPublicEvent } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import { getTip } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

import { PublishedTip } from '../_components/published-tip';

export default function PublishedTipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const tip = useQuery({
    queryKey: ['tip', id],
    enabled: identity.isSuccess && Boolean(id),
    queryFn: () => getTip(identity.data!, id),
  });
  const eventId = tip.data?.eventId ?? null;
  const event = useQuery({
    queryKey: ['event', eventId],
    enabled: Boolean(eventId) && tip.data?.phase === 'published',
    queryFn: () => getPublicEvent(eventId!),
  });

  if (!id) return null;
  if (tip.isSuccess && tip.data.phase !== 'published') {
    return <Redirect href={`/tips/${id}`} />;
  }
  if (identity.isError || tip.isError || (!identity.isPending && !tip.isPending && !tip.data)) {
    return <TipMessage message={t('tips.error')} />;
  }
  if (identity.isPending || tip.isPending || event.isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.inkMuted} />
      </View>
    );
  }
  if (!tip.data) return <TipMessage message={t('tips.error')} />;

  return <PublishedTip tip={tip.data} event={shownEvent(event.data)} />;
}

function TipMessage({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
        padding: space.xl,
      }}
    >
      <AppText variant="body" style={{ textAlign: 'center' }}>
        {message}
      </AppText>
    </View>
  );
}

function shownEvent(event: Awaited<ReturnType<typeof getPublicEvent>> | undefined): {
  title: string;
  startsAt: string | null;
  venueName: string | null;
  imageUrl: string | null;
  city: string | null;
} | null {
  if (!event) return null;
  return {
    title: event.title,
    startsAt: event.startsAt,
    venueName: event.venueName,
    imageUrl: event.imageUrl,
    city: event.meta.address?.city ?? null,
  };
}
