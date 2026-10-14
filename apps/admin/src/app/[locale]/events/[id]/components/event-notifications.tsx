'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
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
import { AdminApiError, adminFetch } from '@/lib/api';
import { toDatetimeLocal, zonedLocalToIso } from '@/lib/zoned-datetime';
import { SentNotifications } from './sent-notifications';

const styles: Record<string, SxProps<Theme>> = {
  card: { p: 2, display: 'flex', flexDirection: 'column', gap: 2 },
};

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
  startsAt: string;
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
  if (canNotify && !customized && (builtScheduleKey !== scheduleKey || builtPlan !== planId)) {
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
          sendAtLocal: toDatetimeLocal(
            offsetBeforeEventStart(new Date(startsAt), offset).toISOString(),
            timezone,
          ),
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

  const startsLabel = new Date(startsAt).toLocaleString(locale, { timeZone: timezone });
  const scheduleStale = customized && builtScheduleKey !== null && builtScheduleKey !== scheduleKey;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('planStarts', { when: startsLabel })}
      </Typography>
      {canNotify ? (
        <Paper variant="outlined" sx={styles.card}>
          <Typography variant="body2">{t('planLead')}</Typography>
          {status === 'published' ? null : <Alert severity="info">{t('planHeld')}</Alert>}
          {notice ? <Alert severity="success">{notice}</Alert> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {scheduleStale ? (
            <Alert
              severity="info"
              action={
                <Button color="inherit" size="small" onClick={() => setCustomized(false)}>
                  {t('refreshPlan')}
                </Button>
              }
            >
              {t('startChanged')}
            </Alert>
          ) : null}
          <FormControl fullWidth>
            <InputLabel id="notification-plan-label">{t('plan')}</InputLabel>
            <Select
              labelId="notification-plan-label"
              label={t('plan')}
              value={planId}
              onChange={(event) => {
                const next = marketingPushPlan(event.target.value);
                if (!next) return;
                setPlanId(next.id);
                setCustomized(false);
              }}
            >
              <MenuItem value="single">{t('planSingle')}</MenuItem>
              <MenuItem value="standard">{t('planStandard')}</MenuItem>
              <MenuItem value="countdown">{t('planCountdown')}</MenuItem>
              <MenuItem value="full">{t('planFull')}</MenuItem>
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              {planId === 'single'
                ? t('planSingleHint')
                : planId === 'countdown'
                  ? t('planCountdownHint')
                  : planId === 'full'
                    ? t('planFullHint')
                    : t('planStandardHint')}
            </Typography>
          </FormControl>
          <FormControl>
            <FormLabel id="plan-audience-label">{t('audienceRule')}</FormLabel>
            <RadioGroup
              aria-labelledby="plan-audience-label"
              value={audience}
              onChange={(event) =>
                setAudience(event.target.value === 'area' ? 'area' : 'area_and_tag')
              }
            >
              <FormControlLabel value="area" control={<Radio />} label={t('audienceArea')} />
              <FormControlLabel
                value="area_and_tag"
                control={<Radio />}
                label={t('audienceAreaAndTag')}
              />
            </RadioGroup>
          </FormControl>
          {drafts.map((draft, index) => (
            <Paper key={draft.id} variant="outlined" sx={styles.card}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle1">{t('notificationN', { n: index + 1 })}</Typography>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    setCustomized(true);
                    setDrafts((current) => current.filter((item) => item.id !== draft.id));
                  }}
                >
                  {t('removeNotification')}
                </Button>
              </Stack>
              <PushScheduleOffsetSelect
                id={`plan-offset-${draft.id}`}
                value={draft.offset}
                onChange={(offset) => onOffset(draft.id, offset)}
              />
              <TextField
                label={t('sendAt')}
                type="datetime-local"
                value={draft.sendAtLocal}
                onChange={(event) =>
                  updateDraft(draft.id, { sendAtLocal: event.target.value, offset: 'custom' })
                }
                fullWidth
                required
                error={sendTimeInPast(draft.sendAtLocal, timezone)}
                helperText={
                  sendTimeInPast(draft.sendAtLocal, timezone) ? t('planPast') : t('planSendAtHint')
                }
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label={t('titleSv')}
                value={draft.titleSv}
                onChange={(event) => updateDraft(draft.id, { titleSv: event.target.value })}
                fullWidth
                required
              />
              <TextField
                label={t('bodySv')}
                value={draft.bodySv}
                onChange={(event) => updateDraft(draft.id, { bodySv: event.target.value })}
                fullWidth
                required
                multiline
                minRows={2}
              />
              <TextField
                label={t('titleEn')}
                value={draft.titleEn}
                onChange={(event) => updateDraft(draft.id, { titleEn: event.target.value })}
                fullWidth
                required
              />
              <TextField
                label={t('bodyEn')}
                value={draft.bodyEn}
                onChange={(event) => updateDraft(draft.id, { bodyEn: event.target.value })}
                fullWidth
                required
                multiline
                minRows={2}
              />
            </Paper>
          ))}
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              onClick={() => {
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
              variant="contained"
              onClick={approvePlan}
              disabled={approve.isPending || drafts.length === 0}
            >
              {approve.isPending
                ? status === 'published'
                  ? t('approvingPlan')
                  : t('savingPlan')
                : status === 'published'
                  ? t('approvePlan')
                  : t('savePlan')}
            </Button>
            {drafts.length === 0 ? (
              <Button onClick={() => setCustomized(false)}>{t('refreshPlan')}</Button>
            ) : null}
          </Stack>
        </Paper>
      ) : (
        <Alert severity="info">{t('eventNotPublished')}</Alert>
      )}
      <Stack spacing={1}>
        <Typography variant="h6" component="h2">
          {t('scheduledTitle')}
        </Typography>
        {scheduled.isError || pending.isError ? (
          <Alert severity="error">{t('loadError')}</Alert>
        ) : null}
        {scheduled.isLoading || pending.isLoading ? (
          <Typography color="text.secondary">{t('loading')}</Typography>
        ) : null}
        {(scheduled.data || pending.data) && waiting.length === 0 ? (
          <Alert severity="info">{t('scheduledEmpty')}</Alert>
        ) : null}
        {waiting.map((item) => (
          <Typography key={item.id} variant="body2">
            {item.sendAt ? new Date(item.sendAt).toLocaleString(locale) : t('asap')}
            {' · '}
            {locale === 'en' ? item.titleEn : item.titleSv}
            {item.status === 'pending' ? ` · ${t('inReview')}` : ''}
          </Typography>
        ))}
      </Stack>
      <SentNotifications eventId={eventId} />
    </Stack>
  );
}
