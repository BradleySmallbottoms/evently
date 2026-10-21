import { bareTipLink, deviceAssetUrl } from '@local-events/domain';
import { Image } from 'expo-image';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { MaxContentWidth } from '@/constants/theme';

import { AskControl } from './ask-control';
import { CollectedCard } from './collected-card';
import { Composer } from './composer';
import { ImageAsk } from './image-ask';
import { endLabel } from './tip-answers';
import { API_URL } from '@/lib/api';
import { ensureIdentity } from '@/lib/identity';
import { chooseTipImage } from '@/lib/tip-photo';
import { sendTipImage, sendTipText } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';
import type { Tip } from '@local-events/contracts';
import { router } from 'expo-router';

export function TipChat({
  tip,
  initialPhoto,
  onDone,
}: {
  tip: Tip;
  initialPhoto?: string;
  onDone: (tip: Tip) => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const scroll = useRef<ScrollView>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(initialPhoto ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const send = useMutation({
    mutationFn: async (body: string) => {
      const identity = await ensureIdentity(locale);
      return sendTipText(identity, tip.id, body);
    },
    onSuccess: (next) => {
      setPending(null);
      setText('');
      onDone(next);
    },
    onError: (err) => {
      setPending(null);
      console.error('tip text failed', err);
      setError(t('tips.error'));
    },
  });

  const remotePhoto = tipPhotoUri(tip.previewImageUrl);
  const photoUri = pickedUri ?? remotePhoto;
  const hasImage = Boolean(photoUri) || tip.imageStatus !== 'none';
  const started = tip.messages.length > 0 || pending != null || hasImage;
  const scanning = tip.imageStatus === 'scanning';
  const reading = [...tip.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.key === 'image')?.body;
  const progress = tip.progress ?? { done: 0, total: 9 };
  const lastAssistant = lastAssistantIndex(tip.messages);

  const reveal = useCallback(() => {
    scroll.current?.scrollToEnd({ animated: false });
  }, []);

  useEffect(() => {
    if (!started) return;
    const frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [started, tip.messages.length, pending]);

  function sendBody(body: string) {
    const next = body.trim();
    if (!next || send.isPending) return;
    setError(null);
    setPending(next);
    send.mutate(next);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.xl,
          paddingBottom: space.lg,
          gap: space.sm,
          width: '100%',
          maxWidth: MaxContentWidth,
          alignSelf: 'center',
        }}
      >
        {/* <BackPill /> */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <View style={{ minWidth: '15%' }}></View>
          <AppText variant="caption" style={{ fontWeight: '600' }}>
            {t('tips.startTitle')}
          </AppText>
          <Pressable style={{ minWidth: '15%' }} onPress={() => router.back()}>
            <AppText variant="caption" style={{ fontWeight: '600', color: colors.danger }}>
              {t('tips.cancel')}
            </AppText>
          </Pressable>
        </View>
        {started ? (
          <CollectedCard
            askKey={tip.question?.key ?? null}
            done={progress.done}
            total={progress.total}
            title={tip.card?.title ?? null}
            startsAt={tip.card?.startsAt ?? null}
            place={tip.card?.place ?? null}
            priceLabel={tip.card?.priceLabel ?? null}
            photoUri={photoUri}
            locale={locale}
            working={pending != null || scanning || photoBusy}
          />
        ) : null}
      </View>

      {started ? (
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={reveal}
          contentContainerStyle={{
            paddingHorizontal: space.xl,
            paddingBottom: insets.bottom + space.lg,
            gap: space.lg,
            width: '100%',
            maxWidth: MaxContentWidth,
            alignSelf: 'center',
          }}
        >
          {hasImage ? (
            <View
              style={{
                alignSelf: 'flex-end',
                width: '85%',
                height: 220,
                borderRadius: radius.lg,
                overflow: 'hidden',
                backgroundColor: colors.line,
              }}
            >
              {photoUri ? (
                <Image
                  source={{ uri: photoUri }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : null}
              {scanning ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: space.sm,
                    padding: space.lg,
                    backgroundColor: 'rgba(0,0,0,0.28)',
                  }}
                >
                  <ActivityIndicator color={colors.card} />
                  {reading ? (
                    <AppText variant="body" style={{ color: colors.card, textAlign: 'center' }}>
                      {reading}
                    </AppText>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
          {tip.messages.map((message, index) => {
            if (message.role === 'assistant' && message.key === 'image' && hasImage) return null;
            if (message.role === 'user') {
              return (
                <Bubble key={`${message.createdAt}-${index}`} mine>
                  {userLabel(message.body, locale, t)}
                </Bubble>
              );
            }
            const stored = answerAfter(tip.messages, index);
            const answer = stored ?? (index === lastAssistant ? pending : null);
            const current = index === lastAssistant && answer == null ? tip.question : null;
            const askKey = current?.key ?? message.key;
            const askOptions = current?.options ?? message.options;
            const askBody = current?.question ?? message.body;
            const hint = askKey ? stepHint(askKey, t) : null;
            return (
              <View key={`${message.createdAt}-${index}`} style={{ gap: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <AssistantAvatar />
                  <Bubble mine={false}>
                    <AppText variant="body" style={{ fontWeight: '600' }}>
                      {askBody}
                    </AppText>
                    {hint ? (
                      <AppText variant="caption" style={{ color: colors.inkMuted }}>
                        {hint}
                      </AppText>
                    ) : null}
                  </Bubble>
                </View>
                {askKey && askKey !== 'image' && (answer != null || current != null) ? (
                  <AskControl
                    key={askKey}
                    askKey={askKey}
                    options={askOptions}
                    answer={answer}
                    locked={answer != null}
                    locale={locale}
                    startsAt={tip.card?.startsAt ?? null}
                    endsAt={tip.card?.endsAt ?? null}
                    onSend={sendBody}
                    onEdit={reveal}
                  />
                ) : null}
                {askKey === 'image' && index === lastAssistant && !scanning && !hasImage ? (
                  <ImageAsk
                    locked={send.isPending}
                    onSkip={() => sendBody('image: none')}
                    onUpload={async () => {
                      try {
                        const shot = await chooseTipImage();
                        if (!shot.ok) {
                          if (shot.reason === 'denied') setError(t('tips.cameraDenied'));
                          return;
                        }
                        setPickedUri(shot.uri);
                        setError(null);
                        setPhotoBusy(true);
                        const identity = await ensureIdentity(locale);
                        onDone(await sendTipImage(identity, tip.id, shot));
                      } catch (err) {
                        console.error('tip image failed', err);
                        setPickedUri(initialPhoto ?? null);
                        setError(
                          err instanceof Error && err.message === 'too_large'
                            ? t('tips.tooLarge')
                            : t('tips.error'),
                        );
                      } finally {
                        setPhotoBusy(false);
                      }
                    }}
                  />
                ) : null}
              </View>
            );
          })}
          {pending ? <Bubble mine>{userLabel(pending, locale, t)}</Bubble> : null}
          {pending ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
              <AssistantAvatar />
              <Bubble mine={false}>
                <ActivityIndicator accessibilityLabel={t('tips.thinking')} color={colors.ink} />
              </Bubble>
            </View>
          ) : null}
          {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
        </ScrollView>
      ) : (
        <View
          style={{
            paddingHorizontal: space.xl,
            paddingTop: space.sm,
            gap: space.sm,
            width: '100%',
            maxWidth: MaxContentWidth,
            alignSelf: 'center',
          }}
        >
          <Composer
            value={text}
            tall
            placeholder={t('tips.writePlaceholder')}
            editable={!send.isPending}
            onChange={setText}
          />
          <PrimaryButton
            label={t('tips.send')}
            arrow
            disabled={text.trim().length === 0 || send.isPending}
            onPress={() => sendBody(text)}
          />
          {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function AssistantAvatar() {
  return (
    <View
      style={{
        width: 48,
        height: 48,
        backgroundColor: colors.cardDarker,
        borderRadius: radius.pill,
        padding: space.lg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Image
        accessible={false}
        source={require('@/assets/images/robot.png')}
        style={{ width: 32, height: 32 }}
        contentFit="contain"
      />
    </View>
  );
}

function tipPhotoUri(url: string | null): string | null {
  if (!url) return null;
  if (Platform.OS === 'web') return url;
  return deviceAssetUrl(url, API_URL);
}

function stepHint(key: string, t: (key: string) => string): string | null {
  const hints = [
    'title',
    'date',
    'startDate',
    'startTime',
    'end',
    'endDate',
    'endTime',
    'place',
    'price',
    'link',
    'description',
    'image',
  ];
  if (!hints.includes(key)) return null;
  return t(`tips.hints.${key}`);
}

function Bubble({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <View
      style={{
        flex: mine ? undefined : 1,
        alignSelf: mine ? 'flex-end' : 'stretch',
        maxWidth: mine ? '82%' : '100%',
        backgroundColor: mine ? colors.accentSoft : colors.card,
        borderRadius: 22,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        gap: 4,
        ...(mine
          ? {}
          : {
              shadowColor: colors.overlay,
              shadowOpacity: 0.06,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 2,
            }),
      }}
    >
      {typeof children === 'string' ? <AppText variant="body">{children}</AppText> : children}
    </View>
  );
}

function lastAssistantIndex(messages: Tip['messages']): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index;
  }
  return -1;
}

function answerAfter(messages: Tip['messages'], index: number): string | null {
  for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
    const message = messages[cursor];
    if (message?.role === 'user') return message.body;
    if (message?.role === 'assistant') return null;
  }
  return null;
}

function userLabel(body: string, locale: string, t: (key: string) => string): string {
  const line = body.trim();
  if (/^link:\s*none$/i.test(line)) return t('tips.noLink');
  if (/^(?:end|endDate|startTime|endTime):\s*none$/i.test(line)) return t('tips.unknown');
  if (/^image:\s*none$/i.test(line)) return t('tips.noPicture');
  const url = line.match(/^link:\s*(\S+)$/i);
  if (url?.[1] && !/^none$/i.test(url[1])) return bareTipLink(url[1]) ?? url[1];
  if (/^price:\s*free$/i.test(line)) return t('tips.free');
  const price = line.match(/^price:\s*(\d{1,6}(?:[.,]\d{1,2})?)$/i);
  if (price?.[1]) return `${price[1].replace('.', ',')} kr`;
  const clock = line.match(/^(?:startTime|endTime):\s*((?:[01]\d|2[0-3]):[0-5]\d)$/i);
  if (clock?.[1]) return clock[1];
  const end = line.match(/^(?:end|endDate):\s*(.+)$/i);
  if (end?.[1]) return endLabel(end[1], locale);
  const date = line.match(/^(?:date|startDate|endDate):\s*(\d{4}-\d{2}-\d{2})$/);
  if (date?.[1]) {
    const [year, month, day] = date[1].split('-').map(Number);
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(year!, month! - 1, day));
  }
  return body;
}
