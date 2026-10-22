import { TIP_DAILY_LIMIT, tipOpenAllowed } from '@local-events/domain';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AcknowledgeAlert } from '@/components/native/acknowledge-alert';
import { TipChatSheet } from '@/components/native/tip-chat-sheet';
import { AppText } from '@/components/ui/app-text';
import { ensureIdentity } from '@/lib/identity';
import { chooseTipImage } from '@/lib/tip-photo';
import { createTip, listTips, sendTipImage } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { TipChrome } from '@/components/ui/tip-chrome';
import { Image } from 'expo-image';

export default function TipStartScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [pending, setPending] = useState<'photo' | 'text' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [sheet, setSheet] = useState<{ id: string; photo?: string } | null>(null);
  const dismissError = useCallback(() => setError(null), []);
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const tips = useQuery({
    queryKey: ['tips', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listTips(identity.data!),
  });
  const openCount = (tips.data?.items ?? []).filter(
    (tip) => tip.status === 'collecting' || tip.status === 'needs_input',
  ).length;
  const atLimit = blocked || (tips.isSuccess && !tipOpenAllowed(openCount).ok);
  const checking = identity.isPending || tips.isLoading || (identity.isSuccess && tips.isPending);
  useFocusEffect(
    useCallback(() => {
      if (!identity.isSuccess) return;
      void tips.refetch().then((result) => {
        if (!result.data) return;
        const count = result.data.items.filter(
          (tip) => tip.status === 'collecting' || tip.status === 'needs_input',
        ).length;
        if (tipOpenAllowed(count).ok) setBlocked(false);
      });
    }, [identity.isSuccess, tips.refetch]),
  );

  async function startText() {
    setPending('text');
    setError(null);
    try {
      const identity = await ensureIdentity(locale);
      const tip = await createTip(identity, { path: 'text', locale });
      setSheet({ id: tip.id });
    } catch (err) {
      if (err instanceof Error && err.message === 'open_limit') {
        setBlocked(true);
        return;
      }
      setError(tipStartError(err, t));
    } finally {
      setPending(null);
    }
  }

  async function startPhoto() {
    setPending('photo');
    setError(null);
    try {
      const shot = await chooseTipImage();
      if (!shot.ok) {
        if (shot.reason === 'denied') setError(t('tips.cameraDenied'));
        return;
      }
      const identity = await ensureIdentity(locale);
      const tip = await createTip(identity, { path: 'photo', locale });
      await sendTipImage(identity, tip.id, {
        contentType: shot.contentType,
        dataBase64: shot.dataBase64,
      });
      setSheet({ id: tip.id, photo: shot.uri });
    } catch (err) {
      if (err instanceof Error && err.message === 'open_limit') {
        setBlocked(true);
        return;
      }
      setError(tipStartError(err, t));
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <TipChrome title={t('tips.startTitle')}>
        <AppText variant="body" style={{ textAlign: 'center', color: colors.inkMuted }}>
          {t('tips.startBody')}
        </AppText>
        <View style={{ alignItems: 'center' }}>
          <Image
            accessible={false}
            source={require('@/assets/images/megafon.png')}
            style={{ width: 200, height: 200 }}
            contentFit="contain"
          />
        </View>
        {checking ? (
          <ActivityIndicator color={colors.ink} />
        ) : atLimit ? (
          <View
            style={{
              backgroundColor: colors.accentSoft,
              borderRadius: radius.lg,
              padding: space.lg,
              gap: space.sm,
            }}
          >
            <AppText variant="body" style={{ textAlign: 'center' }}>
              {t('tips.openLimit', { count: TIP_DAILY_LIMIT })}
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => router.push('/profile/tips')}>
              <AppText variant="label" style={{ textAlign: 'center' }}>
                {t('tips.seeYours')}
              </AppText>
            </Pressable>
          </View>
        ) : (
          <>
            <Choice
              title={t('tips.takePhoto')}
              body={t('tips.takePhotoBody')}
              icon={
                <Image
                  accessible={false}
                  source={require('@/assets/images/kamera.png')}
                  style={{ width: 48, height: 48 }}
                  contentFit="contain"
                />
              }
              pending={pending === 'photo'}
              onPress={() => void startPhoto()}
            />
            <Choice
              title={t('tips.write')}
              body={t('tips.writeBody')}
              icon={
                <Image
                  accessible={false}
                  source={require('@/assets/images/beskrivning.png')}
                  style={{ width: 48, height: 48 }}
                  contentFit="contain"
                />
              }
              pending={pending === 'text'}
              onPress={() => void startText()}
            />
            <AppText variant="caption" style={{ color: colors.inkMuted }}>
              {t('tips.startFoot')}
            </AppText>
          </>
        )}
        <AcknowledgeAlert
          title={t('tips.errorTitle')}
          message={error ?? undefined}
          confirmLabel={t('tips.ok')}
          isPresented={error != null}
          onConfirm={dismissError}
        />
      </TipChrome>
      <TipChatSheet
        tipId={sheet?.id ?? null}
        photo={sheet?.photo}
        onDismiss={() => {
          setSheet(null);
          void tips.refetch();
        }}
      />
    </>
  );
}

function tipStartError(
  err: unknown,
  t: (key: string, options?: { count: number }) => string,
): string {
  if (!(err instanceof Error)) return t('tips.error');
  if (err.message === 'too_large') return t('tips.tooLarge');
  return t('tips.error');
}

function Choice({
  title,
  body,
  icon,
  pending,
  onPress,
}: {
  title: string;
  body: string;
  icon: ReactNode;
  pending: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.line,
        padding: space.lg,
      }}
    >
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" style={{ color: colors.inkMuted }}>
          {body}
        </AppText>
      </View>
      {pending ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <AppText style={{ color: colors.inkMuted }}>›</AppText>
      )}
    </Pressable>
  );
}
