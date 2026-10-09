import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { ConfirmAction } from '@/components/native/confirm-action';
import { EventActionsMenu } from '@/components/native/event-actions-menu';
import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { PrimaryButton } from '@/components/ui/primary-button';
import { MaxContentWidth } from '@/constants/theme';
import { getPublicEvent } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

const HERO =
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=80';

export default function EventDetailScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reportOpen, setReportOpen] = useState(false);

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });
  const event = useQuery({
    queryKey: ['public-event', id],
    queryFn: () => getPublicEvent(id),
    enabled: identity.isSuccess && typeof id === 'string' && id.length > 0,
  });

  async function shareEvent() {
    if (!event.data) return;
    await Share.share({ message: `${event.data.title}` });
  }

  async function copyLink() {
    if (!id) return;
    await Clipboard.setStringAsync(`localevents://events/${id}`);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <ScrollView
        style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 140, gap: space.xl }}
      >
        <View style={{ height: 320, backgroundColor: colors.accentSoft }}>
          <Image source={{ uri: HERO }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 140,
              experimental_backgroundImage:
                'linear-gradient(to bottom, rgba(20,20,20,0) 0%, rgba(20,20,20,0.55) 100%)',
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: Math.max(insets.top, space.lg),
              left: space.xl,
              right: space.xl,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <CircleIconButton
              sf="chevron.left"
              md="chevron-left"
              accessibilityLabel={t('events.back')}
              onPress={() => router.back()}
            />
            <View
              style={{
                backgroundColor: 'rgba(20,20,20,0.35)',
                borderRadius: radius.pill,
                paddingHorizontal: space.md,
                paddingVertical: space.xs + 2,
              }}
            >
              <AppText variant="label" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                {t('events.details')}
              </AppText>
            </View>
            <EventActionsMenu
              accessibilityLabel={t('events.moreActions')}
              shareLabel={t('events.share')}
              copyLinkLabel={t('events.copyLink')}
              reportLabel={t('events.report')}
              onShare={() => void shareEvent()}
              onCopyLink={() => void copyLink()}
              onReport={() => setReportOpen(true)}
            />
          </View>
        </View>

        <View style={{ paddingHorizontal: space.xl, gap: space.lg, marginTop: -space.xxl }}>
          {event.isPending && <AppText variant="caption">{t('events.loading')}</AppText>}
          {event.isError && (
            <AppText variant="caption" style={{ color: colors.danger }}>
              {t('events.loadError')}
            </AppText>
          )}
          {event.data && (
            <>
              <View
                style={{
                  backgroundColor: colors.card as string,
                  borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  padding: space.xl,
                  gap: space.md,
                  boxShadow: shadow.card,
                }}
              >
                <AppText variant="hero">{event.data.title}</AppText>
                <InfoRow
                  icon="calendar"
                  title={t('events.when')}
                  value={`${new Date(event.data.startsAt).toLocaleString(locale)} – ${new Date(
                    event.data.endsAt,
                  ).toLocaleString(locale)}`}
                />
                <InfoRow
                  icon={event.data.mode === 'physical' ? 'mappin.and.ellipse' : 'link'}
                  title={event.data.mode === 'physical' ? t('events.venue') : t('events.online')}
                  value={
                    event.data.mode === 'physical'
                      ? (event.data.venueName ?? t('events.missingVenue'))
                      : (event.data.onlineUrl ?? t('events.missingUrl'))
                  }
                />
              </View>

              <View
                style={{
                  backgroundColor: colors.card as string,
                  borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  padding: space.xl,
                  gap: space.sm,
                  boxShadow: shadow.soft,
                }}
              >
                <AppText variant="subtitle">{t('events.description')}</AppText>
                <AppText variant="body">
                  {event.data.description ?? t('events.noDescription')}
                </AppText>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {event.data ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: space.xl,
            paddingTop: space.md,
            paddingBottom: Math.max(insets.bottom, space.lg),
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: MaxContentWidth,
              backgroundColor: colors.card as string,
              borderRadius: radius.xl,
              borderCurve: 'continuous',
              padding: space.md,
              boxShadow: shadow.card,
            }}
          >
            <PrimaryButton label={t('events.remindMe')} />
          </View>
        </View>
      ) : null}

      <ConfirmAction
        title={t('events.reportTitle')}
        message={t('events.reportMessage')}
        confirmLabel={t('events.reportConfirm')}
        cancelLabel={t('events.cancel')}
        isPresented={reportOpen}
        onIsPresentedChange={setReportOpen}
        onConfirm={() => setReportOpen(false)}
      />
    </View>
  );
}

function InfoRow({ icon, title, value }: { icon: string; title: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.md,
        alignItems: 'center',
        backgroundColor: colors.canvas,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        padding: space.lg,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.pill,
          backgroundColor: colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SymbolView name={icon as never} size={18} tintColor={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="caption">{title}</AppText>
        <AppText variant="subtitle">{value}</AppText>
      </View>
    </View>
  );
}
