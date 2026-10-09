import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Share, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { ConfirmAction } from '@/components/native/confirm-action';
import { EventActionsMenu } from '@/components/native/event-actions-menu';
import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { PrimaryButton } from '@/components/ui/primary-button';
import { MaxContentWidth } from '@/constants/theme';
import {
  fetchCheckInStatus,
  performCodeCheckIn,
  performGeoCheckIn,
} from '@/lib/check-in';
import { getPublicEvent } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import { colors } from '@/theme/colors';
import { radius, shadow, space, typography } from '@/theme/tokens';

const HERO =
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=80';

export default function EventDetailScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reportOpen, setReportOpen] = useState(false);
  const [code, setCode] = useState('');

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });
  const event = useQuery({
    queryKey: ['public-event', id],
    queryFn: () => getPublicEvent(id),
    enabled: typeof id === 'string' && id.length > 0,
  });
  const checkInStatus = useQuery({
    queryKey: ['check-in-status', id, identity.data?.userId],
    queryFn: () => fetchCheckInStatus(identity.data!, id!),
    enabled: identity.isSuccess && typeof id === 'string' && id.length > 0,
  });
  const checkIn = useMutation({
    mutationFn: () => performGeoCheckIn(identity.data!, id!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['check-in-status', id] });
    },
    onError: (err: Error) => {
      const message =
        err.message === 'location_permission_denied'
          ? t('events.checkInPermission')
          : t('events.checkInError');
      Alert.alert(t('events.checkIn'), message);
    },
  });
  const codeCheckIn = useMutation({
    mutationFn: () => performCodeCheckIn(identity.data!, id!, code),
    onSuccess: async () => {
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ['check-in-status', id] });
    },
    onError: () => {
      Alert.alert(t('events.checkIn'), t('events.checkInCodeError'));
    },
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
            {checkInStatus.data?.checkedIn ? (
              <PrimaryButton label={t('events.checkInDone')} disabled />
            ) : event.data.mode === 'physical' ? (
              <View style={{ gap: space.md }}>
                <PrimaryButton
                  label={
                    checkInStatus.isError
                      ? t('events.checkInError')
                      : checkInStatus.isLoading
                        ? t('events.loading')
                        : checkInStatus.data?.open
                          ? t('events.checkIn')
                          : t('events.checkInClosed')
                  }
                  loading={checkIn.isPending || checkInStatus.isLoading}
                  disabled={
                    checkInStatus.isError ||
                    !checkInStatus.data?.open ||
                    !identity.data
                  }
                  onPress={() => checkIn.mutate()}
                />
                {checkInStatus.data?.codeActive && checkInStatus.data.open ? (
                  <CodeCheckInFields
                    code={code}
                    onChangeCode={setCode}
                    loading={codeCheckIn.isPending}
                    disabled={!identity.data}
                    onSubmit={() => codeCheckIn.mutate()}
                    hint={t('events.checkInCodeHint')}
                    placeholder={t('events.checkInCodePlaceholder')}
                    submitLabel={t('events.checkInWithCode')}
                  />
                ) : null}
              </View>
            ) : checkInStatus.data?.codeActive && checkInStatus.data.open ? (
              <CodeCheckInFields
                code={code}
                onChangeCode={setCode}
                loading={codeCheckIn.isPending}
                disabled={!identity.data}
                onSubmit={() => codeCheckIn.mutate()}
                hint={t('events.checkInCodeHint')}
                placeholder={t('events.checkInCodePlaceholder')}
                submitLabel={t('events.checkInWithCode')}
              />
            ) : (
              <PrimaryButton label={t('events.remindMe')} />
            )}
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

function CodeCheckInFields({
  code,
  onChangeCode,
  loading,
  disabled,
  onSubmit,
  hint,
  placeholder,
  submitLabel,
}: {
  code: string;
  onChangeCode: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  hint: string;
  placeholder: string;
  submitLabel: string;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="caption">{hint}</AppText>
      <TextInput
        value={code}
        onChangeText={(v) => onChangeCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="characters"
        autoCorrect={false}
        style={{
          backgroundColor: colors.canvas,
          borderRadius: radius.md,
          borderCurve: 'continuous',
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          fontFamily: typography.familyRegular,
          fontSize: 18,
          letterSpacing: 4,
          color: colors.ink,
          textAlign: 'center',
        }}
      />
      <PrimaryButton
        label={submitLabel}
        loading={loading}
        disabled={disabled || code.trim().length < 4}
        onPress={onSubmit}
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
