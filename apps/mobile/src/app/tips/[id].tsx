import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ensureIdentity } from '@/lib/identity';
import { shareEventLink } from '@/lib/event-share';
import { confirmTip, getTip } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';
import type { Tip, TipCard } from '@local-events/contracts';

import { TipChrome } from '@/components/ui/tip-chrome';
import { TipChat } from './_components/tip-chat';

function whenLabel(value: string | null, locale: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!value.includes('T') || Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function TipScreen() {
  const { id, view, photo } = useLocalSearchParams<{ id: string; view?: string; photo?: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const tip = useQuery({
    queryKey: ['tip', id],
    enabled: identity.isSuccess && Boolean(id),
    queryFn: () => getTip(identity.data!, id!),
    refetchInterval: (query) => (query.state.data?.imageStatus === 'scanning' ? 2000 : false),
  });

  if (!tip.data) {
    return (
      <TipChrome>
        <ActivityIndicator color={colors.ink} />
      </TipChrome>
    );
  }

  const data = tip.data;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tip', id] });
    await queryClient.invalidateQueries({ queryKey: ['tips'] });
  };

  if (data.phase === 'follow_up') {
    return (
      <FollowUp
        tip={data}
        onDone={async (next) => {
          queryClient.setQueryData(['tip', id], next);
          await refresh();
        }}
      />
    );
  }
  if (data.phase === 'published' && view === 'status') return <Status tip={data} />;
  if (data.phase === 'published') {
    return <Published tip={data} onStatus={() => router.setParams({ view: 'status' })} />;
  }
  if (data.phase === 'review' || data.phase === 'failed') return <Status tip={data} />;
  if (data.phase === 'receipt') {
    return (
      <Receipt
        title={t('tips.receiptReadyTitle')}
        body={t('tips.receiptReadyBody')}
        onAnother={() => router.replace('/tips')}
        onHome={() => router.replace('/')}
      />
    );
  }
  if (data.phase === 'confirm' && data.card) {
    return (
      <Confirm
        tip={data}
        card={data.card}
        onDone={(next) => queryClient.setQueryData(['tip', id], next)}
      />
    );
  }
  return (
    <TipChat
      tip={data}
      initialPhoto={typeof photo === 'string' ? photo : undefined}
      onDone={(next) => queryClient.setQueryData(['tip', id], next)}
    />
  );
}

function Confirm({ tip, card, onDone }: { tip: Tip; card: TipCard; onDone: (tip: Tip) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [draft, setDraft] = useState(card);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      const identity = await ensureIdentity(locale);
      return confirmTip(identity, tip.id, { card: draft });
    },
    onSuccess: onDone,
    onError: () => setError(t('tips.error')),
  });
  const rows = [
    ['title', t('tips.name')],
    ['startsAt', t('tips.facts.startDate')],
    ['endsAt', t('tips.facts.endDate')],
    ['place', t('tips.place')],
    ['priceLabel', t('tips.price')],
    ['link', t('tips.link')],
  ] as const;
  return (
    <TipChrome
      title={t('tips.confirmTitle')}
      footer={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={t('tips.change')}
              color={colors.card}
              labelColor={colors.ink}
              onPress={() => setEditing(true)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={t('tips.confirmYes')}
              loading={send.isPending}
              onPress={() => send.mutate()}
            />
          </View>
        </View>
      }
    >
      <AppText variant="body" style={{ textAlign: 'center' }}>
        {t('tips.confirmBody')}
      </AppText>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.line,
          padding: space.lg,
          gap: space.md,
        }}
      >
        <View style={{ gap: 4 }}>
          <AppText variant="caption" style={{ color: colors.inkMuted }}>
            {t('tips.summary')}
          </AppText>
          {editing ? (
            <TextInput
              value={draft.summary ?? ''}
              onChangeText={(next) =>
                setDraft((current) => ({ ...current, summary: next || null }))
              }
              multiline
              placeholder={t('tips.summary')}
              placeholderTextColor={colors.inkMuted}
              style={{
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
                color: colors.ink,
                fontSize: 16,
                paddingVertical: 4,
              }}
            />
          ) : (
            <AppText variant="body">{draft.summary || '—'}</AppText>
          )}
        </View>
        <View style={{ gap: 4 }}>
          <AppText variant="caption" style={{ color: colors.inkMuted }}>
            {t('tips.tags')}
          </AppText>
          {(draft.tags ?? []).length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {(draft.tags ?? []).map((tag) => (
                <View
                  key={tag}
                  style={{
                    backgroundColor: colors.accentSoft,
                    borderRadius: radius.pill,
                    paddingHorizontal: space.md,
                    paddingVertical: space.xs,
                  }}
                >
                  <AppText variant="caption">{tag}</AppText>
                </View>
              ))}
            </View>
          ) : (
            <AppText variant="body">—</AppText>
          )}
        </View>
        {rows.map(([key, label]) => {
          const raw = draft[key];
          const shown =
            key === 'startsAt' || key === 'endsAt' ? whenLabel(raw, locale) || raw : raw;
          return (
            <View key={key} style={{ gap: 4 }}>
              <AppText variant="caption" style={{ color: colors.inkMuted }}>
                {label}
              </AppText>
              {editing ? (
                <TextInput
                  value={raw ?? ''}
                  onChangeText={(next) =>
                    setDraft((current) => ({
                      ...current,
                      [key]: (key === 'link' ? next.replace(/^https?:\/\//i, '') : next) || null,
                    }))
                  }
                  style={{
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                    color: colors.ink,
                    fontSize: 16,
                    paddingVertical: 4,
                  }}
                />
              ) : (
                <AppText variant="body">{shown || '—'}</AppText>
              )}
            </View>
          );
        })}
      </View>
      {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
    </TipChrome>
  );
}

function FollowUp({ tip, onDone }: { tip: Tip; onDone: (tip: Tip) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      const identity = await ensureIdentity(locale);
      return confirmTip(identity, tip.id, {
        description: description || undefined,
        submitFollowUp: true,
      });
    },
    onSuccess: (next) => void onDone(next),
    onError: () => setError(t('tips.error')),
  });
  return (
    <TipChrome
      title={t('tips.followTitle')}
      footer={
        <PrimaryButton
          label={t('tips.submit')}
          loading={send.isPending}
          onPress={() => send.mutate()}
        />
      }
    >
      <AppText variant="body">{t('tips.followBody')}</AppText>
      {tip.followUp?.description ? (
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t('tips.shortDescription')}
          placeholderTextColor={colors.inkMuted}
          multiline
          style={{
            minHeight: 80,
            backgroundColor: colors.card,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.line,
            padding: space.md,
            color: colors.ink,
          }}
        />
      ) : null}
      {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
    </TipChrome>
  );
}

function Receipt({
  title,
  body,
  onAnother,
  onHome,
}: {
  title: string;
  body: string;
  onAnother: () => void;
  onHome: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TipChrome title={title}>
      <AppText variant="body" style={{ textAlign: 'center', color: colors.inkMuted }}>
        {body}
      </AppText>
      <PrimaryButton label={t('tips.another')} onPress={onAnother} />
      <PrimaryButton
        label={t('tips.home')}
        color={colors.card}
        labelColor={colors.ink}
        onPress={onHome}
      />
    </TipChrome>
  );
}

function Published({ tip, onStatus }: { tip: Tip; onStatus: () => void }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const title = tip.found?.title ?? tip.card?.title ?? t('tips.fallbackTitle');
  const place = tip.found?.place ?? tip.card?.place;
  const when = whenLabel(tip.found?.startsAt ?? tip.card?.startsAt ?? null, locale);
  return (
    <TipChrome title={t('tips.yoursTitle')}>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        {t('tips.thanksTitle')}
      </AppText>
      <AppText variant="body" style={{ textAlign: 'center', color: colors.inkMuted }}>
        {t('tips.publishedBody')}
      </AppText>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          padding: space.lg,
          gap: space.xs,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <AppText variant="caption" style={{ color: colors.success }}>
          {t('tips.publishedBadge')}
        </AppText>
        <AppText variant="label">{title}</AppText>
        {when ? <AppText variant="caption">{when}</AppText> : null}
        {place ? <AppText variant="caption">{place}</AppText> : null}
      </View>
      {tip.eventId ? (
        <PrimaryButton
          label={t('tips.viewEvent')}
          onPress={() => router.push(`/events/${tip.eventId}`)}
        />
      ) : null}
      {tip.eventId ? (
        <PrimaryButton
          label={t('tips.share')}
          color={colors.card}
          labelColor={colors.ink}
          onPress={() => void shareEventLink({ title, eventId: tip.eventId! })}
        />
      ) : null}
      <PrimaryButton
        label={t('tips.seeYours')}
        color={colors.card}
        labelColor={colors.ink}
        onPress={() => router.push('/profile/tips')}
      />
      <Pressable accessibilityRole="button" onPress={onStatus}>
        <AppText variant="caption" style={{ textAlign: 'center', color: colors.inkMuted }}>
          {t('tips.seeStatus')}
        </AppText>
      </Pressable>
      <AppText variant="caption" style={{ color: colors.inkMuted }}>
        {t('tips.thanksNote')}
      </AppText>
    </TipChrome>
  );
}

function Status({ tip }: { tip: Tip }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const title = tip.found?.title ?? tip.card?.title ?? t('tips.fallbackTitle');
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
    <TipChrome title={t('tips.statusTitle')}>
      <AppText variant="label">{title}</AppText>
      {steps.map(([key, at]) => (
        <View
          key={key}
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}
        >
          <View style={{ flex: 1 }}>
            <AppText variant="body">
              {key === 'reviewed' && tip.phase !== 'published' && tip.scanStatus === 'in_review'
                ? t('tips.stepReviewing')
                : t(`tips.step.${key}`)}
            </AppText>
            {at ? (
              <AppText variant="caption" style={{ color: colors.inkMuted }}>
                {whenLabel(at, locale)}
              </AppText>
            ) : null}
          </View>
          {at ? (
            <AppText variant="caption" style={{ color: colors.success }}>
              {t('tips.done')}
            </AppText>
          ) : null}
        </View>
      ))}
      {tip.found ? (
        <View style={{ gap: space.sm }}>
          <AppText variant="label">{t('tips.foundTitle')}</AppText>
          <AppText variant="caption" style={{ color: colors.inkMuted }}>
            {t('tips.foundBody')}
          </AppText>
          <Fact label={t('tips.name')} value={tip.found.title} />
          <Fact label={t('tips.date')} value={whenLabel(tip.found.startsAt, locale)} />
          <Fact label={t('tips.place')} value={tip.found.place} />
          <Fact label={t('tips.price')} value={tip.found.priceLabel} />
          <Fact label={t('tips.tags')} value={tip.card?.tags.join(', ') || null} />
          <Fact label={t('tips.description')} value={tip.found.description} />
        </View>
      ) : null}
    </TipChrome>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={{ gap: 2 }}>
      <AppText variant="caption" style={{ color: colors.inkMuted }}>
        {label}
      </AppText>
      <AppText variant="body">{value}</AppText>
    </View>
  );
}
