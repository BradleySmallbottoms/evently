import { bareTipLink, deviceAssetUrl } from '@local-events/domain';
import { Image } from 'expo-image';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  type KeyboardEvent,
} from 'react-native';
import Animated, { runOnUI, scrollTo, useAnimatedRef } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { MaxContentWidth } from '@/constants/theme';

import { AskControl } from './ask-control';
import { ChangeAsk } from './change-ask';
import { ContentWarning } from './content-warning';
import { ChatArrival, ChatScroll } from './chat-arrival';
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

const VERIFY_HOLD_MS = 900;

export function TipChat({
  tip,
  initialPhoto,
  revising = false,
  embedded = false,
  onDone,
}: {
  tip: Tip;
  initialPhoto?: string;
  revising?: boolean;
  /** The chat sits in a sheet, so it does not pad for the status bar. */
  embedded?: boolean;
  onDone: (tip: Tip) => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const openedCount = useRef(tip.messages.length);
  const placed = useRef(false);
  const follow = useRef(true);
  const keyboard = useKeyboardOverlap();
  const keyboardWas = useRef(0);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const verifyingSince = useRef<number | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(initialPhoto ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  function beginVerify() {
    if (verifyingSince.current == null) verifyingSince.current = Date.now();
    setVerifying(true);
  }

  function stopVerify() {
    verifyingSince.current = null;
    setVerifying(false);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }

  function handoff(next: Tip) {
    setPending(null);
    if (next.warning) {
      stopVerify();
      setWarning(next.warning);
      if (!revising) onDone({ ...next, warning: null });
      return;
    }
    if (next.imageStatus === 'scanning') {
      beginVerify();
      onDone(next);
      return;
    }
    const leaving = next.phase === 'confirm' && (revising || tip.phase !== 'confirm');
    if (!leaving) {
      stopVerify();
      setWarning(null);
      setText('');
      onDone(next);
      return;
    }
    beginVerify();
    const elapsed = Date.now() - (verifyingSince.current ?? Date.now());
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => onDone(next), Math.max(0, VERIFY_HOLD_MS - elapsed));
  }

  const send = useMutation({
    mutationFn: async (body: string) => {
      const identity = await ensureIdentity(locale);
      return sendTipText(identity, tip.id, body);
    },
    onSuccess: (next) => handoff(next),
    onError: (err) => {
      setPending(null);
      stopVerify();
      console.error('tip text failed', err);
      setError(t('tips.error'));
    },
  });

  const remotePhoto = tipPhotoUri(tip.previewImageUrl);
  const photoUri = pickedUri ?? remotePhoto;
  const hasImage = Boolean(photoUri) || tip.imageStatus !== 'none';
  const started = tip.messages.length > 0 || hasImage;
  const scanning = tip.imageStatus === 'scanning';
  const reading = [...tip.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.key === 'image')?.body;
  const progress = tip.progress ?? { done: 0, total: 9 };
  const lastAssistant = lastAssistantIndex(tip.messages);

  const scrollToEnd = useCallback(
    (animated: boolean) => {
      runOnUI(() => {
        'worklet';
        scrollTo(scroll, 0, 1_000_000, animated);
      })();
    },
    [scroll],
  );

  const reveal = useCallback(() => {
    follow.current = true;
    scrollToEnd(true);
  }, [scrollToEnd]);

  const onContentSizeChange = useCallback(() => {
    if (!follow.current) return;
    scrollToEnd(false);
  }, [scrollToEnd]);

  useEffect(() => {
    const previous = keyboardWas.current;
    keyboardWas.current = keyboard;
    if (!started || keyboard <= previous) return;
    reveal();
    const frame = requestAnimationFrame(() => reveal());
    return () => cancelAnimationFrame(frame);
  }, [keyboard, reveal, started]);

  useEffect(() => {
    if (!started || placed.current) return;
    placed.current = true;
    const frame = requestAnimationFrame(() => {
      runOnUI(() => {
        'worklet';
        scrollTo(scroll, 0, 1_000_000, false);
      })();
    });
    return () => cancelAnimationFrame(frame);
  }, [scroll, started]);

  function completesNow(): boolean {
    if (revising) return true;
    if (tip.question?.key === 'image') return true;
    const confirming = tip.question?.options.some((option) => option.reply?.startsWith('confirm:'));
    return (
      tip.imageStatus === 'ready' && tip.progress.done === tip.progress.total - 1 && !confirming
    );
  }

  function sendBody(body: string) {
    const next = body.trim();
    if (!next || send.isPending || verifying) return;
    setError(null);
    setWarning(null);
    setPending(next);
    if (completesNow()) beginVerify();
    send.mutate(next);
  }

  function messagePieces(message: Tip['messages'][number], index: number): ReactNode[] {
    if (message.role === 'assistant' && message.key === 'image' && hasImage) return [];
    if (message.role === 'user') {
      return [
        <Bubble key={`${message.createdAt}-user`} mine>
          {userLabel(message.body, locale, t)}
        </Bubble>,
      ];
    }
    const stored = answerAfter(tip.messages, index);
    const answer = stored ?? (index === lastAssistant ? pending : null);
    const current = index === lastAssistant && answer == null ? tip.question : null;
    const askKey = current?.key ?? message.key;
    const askOptions = current?.options ?? message.options;
    const askBody = current?.question ?? message.body;
    const confirming = askOptions.some((option) => option.reply?.startsWith('confirm:'));
    const hint = askKey && !confirming ? stepHint(askKey, t) : null;
    const pieces: ReactNode[] = [
      <View
        key={`${message.createdAt}-bubble`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
      >
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
      </View>,
    ];
    if (askKey && askKey !== 'image' && (answer != null || current != null)) {
      pieces.push(
        <AskControl
          key={`${message.createdAt}-${askKey}`}
          askKey={askKey}
          options={askOptions}
          answer={answer}
          locked={answer != null || verifying}
          locale={locale}
          startsAt={tip.card?.startsAt ?? null}
          endsAt={tip.card?.endsAt ?? null}
          title={tip.card?.title ?? null}
          place={tip.card?.place ?? null}
          priceLabel={tip.card?.priceLabel ?? null}
          link={tip.card?.link ?? null}
          description={tip.found?.description ?? tip.card?.summary ?? null}
          onSend={sendBody}
          onEdit={reveal}
          warning={current ? warning : null}
          onDismissWarning={() => setWarning(null)}
        />,
      );
    }
    if (!revising && askKey === 'image' && index === lastAssistant && !scanning && !hasImage) {
      pieces.push(
        <ImageAsk
          key={`${message.createdAt}-image`}
          locked={send.isPending || verifying}
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
              beginVerify();
              const identity = await ensureIdentity(locale);
              handoff(await sendTipImage(identity, tip.id, shot));
            } catch (err) {
              stopVerify();
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
        />,
      );
    }
    return pieces;
  }

  const frame = { flex: 1, backgroundColor: colors.canvas } as const;
  const column = (
    <>
      <View
        style={{
          paddingTop: (embedded ? space.md : insets.top) + space.sm,
          paddingHorizontal: space.xl,
          paddingBottom: space.lg,
          gap: space.sm,
          width: '100%',
          maxWidth: MaxContentWidth,
          alignSelf: 'center',
        }}
      >
        {/* <BackPill /> */}
        {/* <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <View style={{ minWidth: '15%' }}></View>
          <AppText variant="caption" style={{ fontWeight: '600' }}>
            {t('tips.startTitle')}
          </AppText>
          <Pressable style={{ minWidth: '15%' }} onPress={() => router.back()}>
            <AppText variant="caption" style={{ fontWeight: '600', color: colors.danger }}>
              {t('tips.cancel')}
            </AppText>
          </Pressable>
        </View> */}
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
        <ChatScroll.Provider value={scroll}>
          <Animated.ScrollView
            ref={scroll}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScrollBeginDrag={() => {
              follow.current = false;
            }}
            onContentSizeChange={onContentSizeChange}
            contentContainerStyle={{
              paddingHorizontal: space.xl,
              // The list runs under the keyboard. This padding is the scroll range
              // that brings the send button up above it.
              paddingBottom: (keyboard > 0 ? keyboard : insets.bottom) + space.lg,
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
            {tip.messages.slice(0, openedCount.current).map((message, index) => (
              <View key={`${message.createdAt}-${index}`} style={{ gap: space.md }}>
                {messagePieces(message, index)}
              </View>
            ))}
            <ChatArrival
              key={tip.id}
              pieces={tip.messages
                .slice(openedCount.current)
                .flatMap((message, offset) => messagePieces(message, openedCount.current + offset))}
            />
            {revising ? (
              <ChangeAsk
                tip={tip}
                locale={locale}
                locked={send.isPending || verifying}
                warning={warning}
                onSend={sendBody}
                onEdit={reveal}
                onDismissWarning={() => setWarning(null)}
                question={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <AssistantAvatar />
                    <Bubble mine={false}>
                      <AppText variant="body" style={{ fontWeight: '600' }}>
                        {t('tips.changeAsk')}
                      </AppText>
                    </Bubble>
                  </View>
                }
              />
            ) : null}
            {verifying ? (
              <ChatArrival
                pieces={[
                  <View
                    key="verifying"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                  >
                    <AssistantAvatar />
                    <Bubble mine={false}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <ActivityIndicator
                          accessibilityLabel={t('tips.verifying')}
                          size="small"
                          color={colors.ink}
                        />
                        <AppText variant="body" style={{ fontWeight: '600' }}>
                          {t('tips.verifying')}
                        </AppText>
                      </View>
                    </Bubble>
                  </View>,
                ]}
              />
            ) : null}
            {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
          </Animated.ScrollView>
        </ChatScroll.Provider>
      ) : (
        <View
          style={{
            paddingHorizontal: space.xl,
            paddingTop: space.sm,
            gap: space.lg,
            width: '100%',
            maxWidth: MaxContentWidth,
            alignSelf: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: colors.cardDarkest,
              borderWidth: 1,
              borderColor: colors.line,
              padding: space.lg,
              borderRadius: radius.lg,
            }}
          >
            <AppText variant="caption">{t('tips.startFoot')}</AppText>
          </View>
          <Composer
            value={text}
            tall
            placeholder={t('tips.writePlaceholder')}
            editable={!send.isPending}
            onChange={(value) => {
              setText(value);
              if (warning) setWarning(null);
            }}
          />
          <PrimaryButton
            label={t('tips.send')}
            arrow
            loading={send.isPending}
            disabled={text.trim().length === 0 || send.isPending}
            onPress={() => sendBody(text)}
          />
          {warning ? <ContentWarning key={warning} text={warning} /> : null}
          {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
        </View>
      )}
    </>
  );

  if (!started) {
    return (
      <KeyboardAvoidingView style={frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {column}
      </KeyboardAvoidingView>
    );
  }
  return <View style={frame}>{column}</View>;
}

/** Height of the keyboard covering the bottom of the screen. */
function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (Platform.OS === 'ios') {
      const sub = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
        const covered = Dimensions.get('screen').height - event.endCoordinates.screenY;
        setOverlap(Math.max(0, Math.round(covered)));
      });
      return () => sub.remove();
    }
    const show = Keyboard.addListener('keyboardDidShow', (event: KeyboardEvent) => {
      setOverlap(Math.max(0, Math.round(event.endCoordinates.height)));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return overlap;
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
  if (/^confirm:\s*/i.test(line)) return t('tips.yes');
  const corrected = line.match(/^(?:title|place|description):\s*(.+)$/i);
  if (corrected?.[1]) return corrected[1];
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
