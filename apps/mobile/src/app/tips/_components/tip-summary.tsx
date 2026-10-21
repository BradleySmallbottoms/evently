import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { deviceAssetUrl } from '@local-events/domain';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Tip, TipCard } from '@local-events/contracts';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { MaxContentWidth } from '@/constants/theme';
import { API_URL } from '@/lib/api';
import { ensureIdentity } from '@/lib/identity';
import { foundTipClock, foundTipDay } from '@/lib/tip-clock';
import { confirmTip } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';
import { BackPill } from '@/components/ui/back-pill';

export function TipSummary({
  tip,
  photo,
  onDone,
}: {
  tip: Tip;
  photo?: string;
  onDone: (tip: Tip) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const alreadySent = useRef(tip.phase !== 'confirm').current;
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TipCard>(tip.card ?? emptyCard());
  const [description, setDescription] = useState(tip.found?.description ?? tip.card?.summary ?? '');
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const sent = tip.phase !== 'confirm' || sending;
  const waiting = sending && tip.phase === 'confirm';
  const ease = Easing.bezier(0.23, 1, 0.32, 1);
  const fadeIn = () => FadeIn.duration(reduced ? 120 : 240).easing(ease);
  const fadeOut = () => FadeOut.duration(reduced ? 100 : 180).easing(ease);
  const layout = () => LinearTransition.duration(reduced ? 120 : 280).easing(ease);
  const send = useMutation({
    mutationFn: async () => {
      const identity = await ensureIdentity(locale);
      const summary = (descriptionTouched ? description : (draft.summary ?? ''))
        .trim()
        .slice(0, 500);
      return confirmTip(identity, tip.id, {
        card: {
          ...draft,
          title: draft.title?.trim().slice(0, 200) || null,
          startsAt: draft.startsAt?.trim().slice(0, 40) || null,
          endsAt: draft.endsAt?.trim().slice(0, 40) || null,
          place: draft.place?.trim().slice(0, 200) || null,
          priceLabel: draft.priceLabel?.trim().slice(0, 40) || null,
          link:
            draft.link
              ?.trim()
              .replace(/^https?:\/\//i, '')
              .slice(0, 500) || null,
          summary: summary || null,
        },
        ...(descriptionTouched && description.trim()
          ? { description: description.trim().slice(0, 500) }
          : {}),
      });
    },
    onSuccess: (next) => {
      if (process.env.EXPO_OS === 'ios') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      onDone(next);
    },
    onError: () => {
      setSending(false);
      setError(t('tips.error'));
    },
  });
  const image = previewUri(tip.previewImageUrl) ?? photo ?? null;
  const title = draft.title?.trim() || t('tips.fallbackTitle');
  const when = formatWhen(draft.startsAt, locale, 'short', true);
  const place = draft.place?.trim() || null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.xl,
          paddingBottom: space.xl,
          gap: space.lg,
          width: '100%',
          maxWidth: MaxContentWidth,
          alignSelf: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
          <BackPill />
          <AppText
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 17,
              fontWeight: '700',
              color: colors.ink,
            }}
          >
            {t('tips.statusTitle')}
          </AppText>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          {image ? (
            <Image
              source={{ uri: image }}
              style={{ width: 84, height: 84, borderRadius: 18 }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                width: 84,
                height: 84,
                borderRadius: 18,
                backgroundColor: colors.cardDarker,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialIcons name="image" size={28} color={colors.inkMuted} />
            </View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <AppText
              numberOfLines={2}
              style={{ fontSize: 22, lineHeight: 26, fontWeight: '700', color: colors.ink }}
            >
              {title}
            </AppText>
            {when ? <Meta icon="calendar-today" label={when} /> : null}
            {place ? <Meta icon="place" label={place} /> : null}
          </View>
        </View>
        {sent ? (
          <Animated.View
            entering={alreadySent ? undefined : fadeIn()}
            layout={reduced ? undefined : layout()}
            style={{ minHeight: 72, justifyContent: 'center' }}
          >
            {waiting ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Animated.View entering={alreadySent ? undefined : fadeIn()}>
                <StatusList tip={tip} locale={locale} />
              </Animated.View>
            )}
          </Animated.View>
        ) : null}
        <Animated.View
          layout={reduced ? undefined : layout()}
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.line,
            padding: space.lg,
            gap: space.md,
          }}
        >
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <MaterialIcons name="auto-awesome" size={16} color={colors.accent} />
            <View style={{ flex: 1, gap: 4 }}>
              <AppText style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
                {t('tips.foundTitle')}
              </AppText>
              <AppText variant="caption" style={{ color: colors.inkMuted }}>
                {t('tips.foundBody')}
              </AppText>
            </View>
          </View>
          <GatheredRow
            icon="music-note"
            label={t('tips.name')}
            value={draft.title}
            editing={editing}
            onChange={(next) => setDraft((current) => ({ ...current, title: next || null }))}
          />
          <GatheredRow
            icon="calendar-today"
            label={t('tips.date')}
            value={editing ? draft.startsAt : formatWhen(draft.startsAt, locale, 'long', false)}
            editing={editing}
            onChange={(next) => setDraft((current) => ({ ...current, startsAt: next || null }))}
          />
          {draft.endsAt ? (
            <GatheredRow
              icon="calendar-today"
              label={t('tips.facts.endDate')}
              value={editing ? draft.endsAt : formatWhen(draft.endsAt, locale, 'long', false)}
              editing={editing}
              onChange={(next) => setDraft((current) => ({ ...current, endsAt: next || null }))}
            />
          ) : null}
          <GatheredRow
            icon="place"
            label={t('tips.place')}
            value={draft.place}
            editing={editing}
            onChange={(next) => setDraft((current) => ({ ...current, place: next || null }))}
          />
          <GatheredRow
            icon="thumb-up"
            label={t('tips.price')}
            value={draft.priceLabel}
            editing={editing}
            onChange={(next) => setDraft((current) => ({ ...current, priceLabel: next || null }))}
          />
          <GatheredRow
            icon="local-offer"
            label={t('tips.category')}
            value={(draft.tags ?? []).join(' › ')}
          />
          <GatheredRow
            icon="subject"
            label={t('tips.description')}
            value={description || null}
            editing={editing}
            onChange={(next) => {
              setDescriptionTouched(true);
              setDescription(next);
            }}
          />
          {draft.link || editing ? (
            <GatheredRow
              icon="link"
              label={t('tips.link')}
              value={draft.link}
              editing={editing}
              onChange={(next) =>
                setDraft((current) => ({
                  ...current,
                  link: next.replace(/^https?:\/\//i, '') || null,
                }))
              }
            />
          ) : null}
        </Animated.View>
        {tip.eventId && tip.phase === 'published' ? <EventLink eventId={tip.eventId} /> : null}
        {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
      </ScrollView>
      {!sent ? (
        <Animated.View
          entering={fadeIn()}
          exiting={fadeOut()}
          style={{
            flexDirection: 'row',
            gap: space.sm,
            paddingHorizontal: space.xl,
            paddingBottom: insets.bottom + space.lg,
            width: '100%',
            maxWidth: MaxContentWidth,
            alignSelf: 'center',
          }}
        >
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={t('tips.change')}
              color={colors.card}
              labelColor={colors.ink}
              onPress={() => setEditing(true)}
              style={{ borderWidth: 1, borderColor: colors.line }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={t('tips.confirmYes')}
              disabled={sending}
              onPress={() => {
                setError(null);
                setSending(true);
                send.mutate();
              }}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function StatusList({ tip, locale }: { tip: Tip; locale: string }) {
  const { t } = useTranslation();
  const steps = [
    ['received', tip.timeline.submittedAt],
    ['analyzed', tip.timeline.analyzedAt],
    ['completed', tip.timeline.completedAt],
    [
      'reviewed',
      tip.phase === 'published'
        ? tip.timeline.reviewedAt
        : tip.scanStatus === 'in_review'
          ? null
          : tip.timeline.reviewedAt,
    ],
  ] as const;
  return (
    <View style={{ gap: space.lg, paddingVertical: space.sm }}>
      <View
        style={{
          position: 'absolute',
          left: 10,
          top: 22,
          bottom: 22,
          width: 2,
          backgroundColor: steps.every(([, at]) => at) ? colors.success : colors.line,
        }}
      />
      {steps.map(([key, at]) => {
        const done = Boolean(at);
        const label =
          key === 'reviewed' && tip.phase !== 'published' && tip.scanStatus === 'in_review'
            ? t('tips.stepReviewing')
            : t(`tips.step.${key}`);
        return (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: done ? colors.success : colors.canvas,
                borderWidth: done ? 0 : 1.5,
                borderColor: colors.line,
              }}
            >
              {done ? <MaterialIcons name="check" size={14} color={colors.card} /> : null}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
                {label}
              </AppText>
              {at ? (
                <AppText variant="caption" style={{ color: colors.inkMuted }}>
                  {stamp(at, locale)}
                </AppText>
              ) : null}
            </View>
            {done ? (
              <AppText variant="caption" style={{ color: colors.success, fontWeight: '600' }}>
                {t('tips.done')}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function GatheredRow({
  icon,
  label,
  value,
  editing,
  onChange,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string | null;
  editing?: boolean;
  onChange?: (next: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
      <MaterialIcons name={icon} size={18} color={colors.accent} style={{ marginTop: 2 }} />
      <AppText style={{ width: 92, fontSize: 15, fontWeight: '600', color: colors.ink }}>
        {label}
      </AppText>
      {editing && onChange ? (
        <TextInput
          value={value ?? ''}
          onChangeText={onChange}
          multiline
          placeholder="—"
          placeholderTextColor={colors.inkMuted}
          style={{ flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 0 }}
        />
      ) : (
        <AppText style={{ flex: 1, fontSize: 15, color: colors.ink }}>
          {value?.trim() || '—'}
        </AppText>
      )}
    </View>
  );
}

function Meta({ icon, label }: { icon: 'calendar-today' | 'place'; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <MaterialIcons name={icon} size={14} color={colors.accent} />
      <AppText numberOfLines={1} variant="caption" style={{ color: colors.ink, flexShrink: 1 }}>
        {label}
      </AppText>
    </View>
  );
}

function BackMark() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('events.back')}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        router.back();
      }}
      style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
    >
      {process.env.EXPO_OS === 'ios' ? (
        <SymbolView name={'chevron.left' as never} size={18} tintColor={colors.ink} />
      ) : (
        <MaterialIcons name="chevron-left" size={24} color={colors.ink} />
      )}
    </Pressable>
  );
}

function EventLink({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/events/${eventId}`)}>
      <AppText variant="caption" style={{ color: colors.inkMuted }}>
        {t('tips.viewEvent')}
      </AppText>
    </Pressable>
  );
}

function emptyCard(): TipCard {
  return {
    title: null,
    startsAt: null,
    place: null,
    priceLabel: null,
    link: null,
    endsAt: null,
    summary: null,
    tags: [],
  };
}

function previewUri(url: string | null): string | null {
  if (!url) return null;
  if (Platform.OS === 'web') return url;
  return deviceAssetUrl(url, API_URL);
}

function formatWhen(
  value: string | null,
  locale: string,
  month: 'short' | 'long',
  weekday: boolean,
): string | null {
  const day = foundTipDay(value);
  if (!day) return null;
  const [year, monthIndex, date] = day.split('-').map(Number);
  const formatted = new Intl.DateTimeFormat(locale, {
    weekday: weekday ? 'short' : undefined,
    day: 'numeric',
    month,
    year: 'numeric',
  })
    .format(new Date(year!, monthIndex! - 1, date))
    .replace(/\./g, '');
  const label = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  const clock = foundTipClock(value);
  return clock ? `${label}, ${clock}` : label;
}

function stamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Stockholm',
  })
    .format(date)
    .replace(/\./g, '');
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Stockholm',
  }).format(date);
  return `${day}, ${time}`;
}
