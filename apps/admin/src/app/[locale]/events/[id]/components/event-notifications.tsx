'use client';

import {
  canAdminNotifyEvent,
  DEFAULT_MARKETING_PUSH_PLAN,
  MAX_ADMIN_EVENT_PUSH_PLAN,
  marketingPushPlan,
  offsetBeforeEventStart,
  reminderPushCopy,
  type MarketingPushPlanId,
  type PushScheduleOffset,
} from '@local-events/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  PushScheduleOffsetSelect,
  type ScheduleOffsetChoice,
} from '@/components/push-schedule-offset';
import { LoadingRows } from '@/components/list-state';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { AdminApiError, adminFetch } from '@/lib/api';
import { toDatetimeLocal, zonedLocalToIso } from '@/lib/zoned-datetime';
import { SentNotifications } from './sent-notifications';

type Audience = 'area' | 'area_and_tag';

type DraftNote = {
  id: string;
  offset: ScheduleOffsetChoice;
  sendAtLocal: string;
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
};

type ScheduledPush = {
  id: string;
  eventId: string | null;
  kind: string;
  titleSv: string;
  titleEn: string;
  sendAt: string | null;
  status: string;
};

function draftFromOffset(
  title: string,
  startsAt: string,
  timezone: string,
  offset: PushScheduleOffset,
): DraftNote {
  const sendAt = offsetBeforeEventStart(new Date(startsAt), offset);
  const copy = reminderPushCopy(title, offset);
  return {
    id: crypto.randomUUID(),
    offset,
    sendAtLocal: toDatetimeLocal(sendAt.toISOString(), timezone),
    titleSv: copy.titleSv,
    bodySv: copy.bodySv,
    titleEn: copy.titleEn,
    bodyEn: copy.bodyEn,
  };
}

function draftsForPlan(
  planId: MarketingPushPlanId,
  title: string,
  startsAt: string,
  timezone: string,
): DraftNote[] {
  const plan = marketingPushPlan(planId) ?? marketingPushPlan(DEFAULT_MARKETING_PUSH_PLAN);
  if (!plan) return [];
  return plan.offsets.map((offset) => draftFromOffset(title, startsAt, timezone, offset));
}

function sendTimeInPast(local: string, timezone: string): boolean {
  try {
    return new Date(zonedLocalToIso(local, timezone)).getTime() <= Date.now();
  } catch {
    return false;
  }
}

function nextOffset(drafts: DraftNote[]): PushScheduleOffset {
  const used = new Set(drafts.map((draft) => draft.offset));
  if (!used.has('hour')) return 'hour';
  if (!used.has('day')) return 'day';
  return 'week';
}

export function EventNotifications({
  eventId,
  title,
  startsAt,
  timezone,
  status,
}: {
  eventId: string;
  title: string;
  startsAt: string | null;
  timezone: string;
  status: string;
}) {
  const t = useTranslations('PushMessages');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [planId, setPlanId] = useState<MarketingPushPlanId>(DEFAULT_MARKETING_PUSH_PLAN);
  const [audience, setAudience] = useState<Audience>('area_and_tag');
  const [drafts, setDrafts] = useState<DraftNote[]>([]);
  const [customized, setCustomized] = useState(false);
  const [builtScheduleKey, setBuiltScheduleKey] = useState<string | null>(null);
  const [builtPlan, setBuiltPlan] = useState<MarketingPushPlanId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canNotify = canAdminNotifyEvent(status);
  const scheduleKey = `${eventId}|${startsAt}|${timezone}`;
  if (
    canNotify &&
    startsAt &&
    !customized &&
    (builtScheduleKey !== scheduleKey || builtPlan !== planId)
  ) {
    setBuiltScheduleKey(scheduleKey);
    setBuiltPlan(planId);
    setDrafts(draftsForPlan(planId, title, startsAt, timezone));
    setNotice(null);
    setError(null);
  }

  const scheduled = useQuery({
    queryKey: ['admin-push-messages', 'approved'],
    queryFn: () => adminFetch<{ items: ScheduledPush[] }>('/push-messages?status=approved'),
  });
  const pending = useQuery({
    queryKey: ['admin-push-messages', 'pending'],
    queryFn: () => adminFetch<{ items: ScheduledPush[] }>('/push-messages?status=pending'),
  });
  const waiting = [...(pending.data?.items ?? []), ...(scheduled.data?.items ?? [])].filter(
    (item) => item.eventId === eventId && item.kind === 'event',
  );

  const approve = useMutation({
    mutationFn: (
      notifications: {
        titleSv: string;
        bodySv: string;
        titleEn: string;
        bodyEn: string;
        sendAt: string;
      }[],
    ) =>
      adminFetch<{ items: { id: string }[] }>('/push-messages/event-plan', {
        method: 'POST',
        body: JSON.stringify({ eventId, audience, notifications }),
      }),
    onSuccess: async () => {
      setNotice(status === 'published' ? t('planApproved') : t('planSaved'));
      setError(null);
      setDrafts([]);
      setCustomized(true);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
      await queryClient.invalidateQueries({
        queryKey: ['admin-event-sent-notifications', eventId],
      });
    },
    onError: (err) => {
      if (err instanceof AdminApiError && err.code === 'event_not_published') {
        setError(t('eventNotPublished'));
        return;
      }
      setError(t('planError'));
    },
  });

  function updateDraft(id: string, patch: Partial<DraftNote>) {
    setCustomized(true);
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
  }

  function onOffset(id: string, offset: ScheduleOffsetChoice) {
    setCustomized(true);
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== id) return draft;
        if (offset === 'custom') return { ...draft, offset };
        const previous = draft.offset === 'custom' ? null : reminderPushCopy(title, draft.offset);
        const nextCopy = reminderPushCopy(title, offset);
        const untouched =
          previous !== null &&
          draft.titleSv === previous.titleSv &&
          draft.bodySv === previous.bodySv &&
          draft.titleEn === previous.titleEn &&
          draft.bodyEn === previous.bodyEn;
        return {
          ...draft,
          offset,
          sendAtLocal: startsAt
            ? toDatetimeLocal(
                offsetBeforeEventStart(new Date(startsAt), offset).toISOString(),
                timezone,
              )
            : draft.sendAtLocal,
          ...(untouched ? nextCopy : {}),
        };
      }),
    );
  }

  function approvePlan() {
    setNotice(null);
    setError(null);
    if (drafts.length === 0) {
      setError(t('planEmpty'));
      return;
    }
    let notifications: {
      titleSv: string;
      bodySv: string;
      titleEn: string;
      bodyEn: string;
      sendAt: string;
    }[];
    try {
      notifications = drafts.map((draft) => ({
        titleSv: draft.titleSv.trim(),
        bodySv: draft.bodySv.trim(),
        titleEn: draft.titleEn.trim(),
        bodyEn: draft.bodyEn.trim(),
        sendAt: zonedLocalToIso(draft.sendAtLocal, timezone.trim() || 'Europe/Stockholm'),
      }));
    } catch {
      setError(t('planInvalidTime'));
      return;
    }
    if (
      notifications.some((item) => !item.titleSv || !item.bodySv || !item.titleEn || !item.bodyEn)
    ) {
      setError(t('planIncomplete'));
      return;
    }
    if (notifications.some((item) => new Date(item.sendAt).getTime() <= Date.now())) {
      setError(t('planPast'));
      return;
    }
    approve.mutate(notifications);
  }

  const startsLabel = startsAt
    ? new Date(startsAt).toLocaleString(locale, { timeZone: timezone })
    : '—';
  const scheduleStale = customized && builtScheduleKey !== null && builtScheduleKey !== scheduleKey;
  const planLabels = {
    single: t('planSingle'),
    standard: t('planStandard'),
    countdown: t('planCountdown'),
    full: t('planFull'),
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('planStarts', { when: startsLabel })}</p>
      {canNotify ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">{t('planLead')}</p>
            {status === 'published' ? null : (
              <Alert>
                <AlertDescription>{t('planHeld')}</AlertDescription>
              </Alert>
            )}
            {notice ? (
              <Alert>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {scheduleStale ? (
              <Alert>
                <AlertDescription>{t('startChanged')}</AlertDescription>
                <AlertAction>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCustomized(false)}
                  >
                    {t('refreshPlan')}
                  </Button>
                </AlertAction>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor="notification-plan">{t('plan')}</FieldLabel>
              <Select
                items={planLabels}
                value={planId}
                onValueChange={(next) => {
                  if (next == null) return;
                  const plan = marketingPushPlan(next);
                  if (!plan) return;
                  setPlanId(plan.id);
                  setCustomized(false);
                }}
              >
                <SelectTrigger id="notification-plan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="single">{t('planSingle')}</SelectItem>
                    <SelectItem value="standard">{t('planStandard')}</SelectItem>
                    <SelectItem value="countdown">{t('planCountdown')}</SelectItem>
                    <SelectItem value="full">{t('planFull')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {planId === 'single'
                  ? t('planSingleHint')
                  : planId === 'countdown'
                    ? t('planCountdownHint')
                    : planId === 'full'
                      ? t('planFullHint')
                      : t('planStandardHint')}
              </FieldDescription>
            </Field>
            <FieldSet>
              <FieldLegend variant="label" id="plan-audience-label">
                {t('audienceRule')}
              </FieldLegend>
              <RadioGroup
                aria-labelledby="plan-audience-label"
                value={audience}
                onValueChange={(next) => setAudience(next === 'area' ? 'area' : 'area_and_tag')}
              >
                <Field orientation="horizontal">
                  <RadioGroupItem value="area" id="audience-area" />
                  <FieldLabel htmlFor="audience-area">{t('audienceArea')}</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <RadioGroupItem value="area_and_tag" id="audience-area-and-tag" />
                  <FieldLabel htmlFor="audience-area-and-tag">{t('audienceAreaAndTag')}</FieldLabel>
                </Field>
              </RadioGroup>
            </FieldSet>
            {drafts.map((draft, index) => {
              const past = sendTimeInPast(draft.sendAtLocal, timezone);
              return (
                <Card key={draft.id}>
                  <CardHeader>
                    <CardTitle>{t('notificationN', { n: index + 1 })}</CardTitle>
                    <CardAction>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCustomized(true);
                          setDrafts((current) => current.filter((item) => item.id !== draft.id));
                        }}
                      >
                        {t('removeNotification')}
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <PushScheduleOffsetSelect
                      id={`plan-offset-${draft.id}`}
                      value={draft.offset}
                      onChange={(offset) => onOffset(draft.id, offset)}
                    />
                    <Field data-invalid={past || undefined}>
                      <FieldLabel htmlFor={`plan-send-${draft.id}`}>{t('sendAt')}</FieldLabel>
                      <Input
                        id={`plan-send-${draft.id}`}
                        type="datetime-local"
                        required
                        value={draft.sendAtLocal}
                        aria-invalid={past || undefined}
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            sendAtLocal: event.target.value,
                            offset: 'custom',
                          })
                        }
                      />
                      <FieldDescription>
                        {past ? t('planPast') : t('planSendAtHint')}
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`plan-title-sv-${draft.id}`}>{t('titleSv')}</FieldLabel>
                      <Input
                        id={`plan-title-sv-${draft.id}`}
                        required
                        value={draft.titleSv}
                        onChange={(event) => updateDraft(draft.id, { titleSv: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`plan-body-sv-${draft.id}`}>{t('bodySv')}</FieldLabel>
                      <Textarea
                        id={`plan-body-sv-${draft.id}`}
                        required
                        rows={2}
                        value={draft.bodySv}
                        onChange={(event) => updateDraft(draft.id, { bodySv: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`plan-title-en-${draft.id}`}>{t('titleEn')}</FieldLabel>
                      <Input
                        id={`plan-title-en-${draft.id}`}
                        required
                        value={draft.titleEn}
                        onChange={(event) => updateDraft(draft.id, { titleEn: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`plan-body-en-${draft.id}`}>{t('bodyEn')}</FieldLabel>
                      <Textarea
                        id={`plan-body-en-${draft.id}`}
                        required
                        rows={2}
                        value={draft.bodyEn}
                        onChange={(event) => updateDraft(draft.id, { bodyEn: event.target.value })}
                      />
                    </Field>
                  </CardContent>
                </Card>
              );
            })}
            <div className="flex flex-row flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!startsAt) return;
                  setCustomized(true);
                  setDrafts((current) => [
                    ...current,
                    draftFromOffset(title, startsAt, timezone, nextOffset(current)),
                  ]);
                }}
                disabled={drafts.length >= MAX_ADMIN_EVENT_PUSH_PLAN}
              >
                {t('addNotification')}
              </Button>
              <Button
                type="button"
                onClick={approvePlan}
                disabled={approve.isPending || drafts.length === 0}
              >
                {approve.isPending ? <Spinner data-icon="inline-start" /> : null}
                {approve.isPending
                  ? status === 'published'
                    ? t('approvingPlan')
                    : t('savingPlan')
                  : status === 'published'
                    ? t('approvePlan')
                    : t('savePlan')}
              </Button>
              {drafts.length === 0 ? (
                <Button type="button" variant="ghost" onClick={() => setCustomized(false)}>
                  {t('refreshPlan')}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <AlertDescription>{t('eventNotPublished')}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('scheduledTitle')}</h2>
        {scheduled.isError || pending.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t('loadError')}</AlertDescription>
          </Alert>
        ) : null}
        {scheduled.isLoading || pending.isLoading ? <LoadingRows /> : null}
        {(scheduled.data || pending.data) && waiting.length === 0 ? (
          <Alert>
            <AlertDescription>{t('scheduledEmpty')}</AlertDescription>
          </Alert>
        ) : null}
        {waiting.map((item) => (
          <p key={item.id} className="text-sm">
            {item.sendAt ? new Date(item.sendAt).toLocaleString(locale) : t('asap')}
            {' · '}
            {locale === 'en' ? item.titleEn : item.titleSv}
            {item.status === 'pending' ? ` · ${t('inReview')}` : ''}
          </p>
        ))}
      </div>
      <SentNotifications eventId={eventId} />
    </div>
  );
}
