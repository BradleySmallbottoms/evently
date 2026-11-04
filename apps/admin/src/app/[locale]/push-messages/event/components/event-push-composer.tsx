'use client';

import {
  canAdminNotifyEvent,
  defaultPushMessageCopy,
  offsetBeforeEventStart,
  publishedPushCopy,
  reminderPushCopy,
  type PushScheduleOffset,
} from '@local-events/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  PushScheduleOffsetSelect,
  type ScheduleOffsetChoice,
} from '@/components/push-schedule-offset';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Link, useRouter } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

type EventOption = {
  id: string;
  title: string;
  publisherName: string;
  startsAt: string | null;
  status: string;
};

type PushMessage = {
  id: string;
};

function isReminderOffset(offset: ScheduleOffsetChoice): offset is PushScheduleOffset {
  return offset === 'week' || offset === 'day' || offset === 'hour';
}

function localSendAt(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function EventPushComposer({ initialEventId }: { initialEventId?: string }) {
  const t = useTranslations('PushMessages');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [eventId, setEventId] = useState(initialEventId ?? '');
  const [audience, setAudience] = useState<'area' | 'area_and_tag'>('area_and_tag');
  const [titleSv, setTitleSv] = useState('');
  const [bodySv, setBodySv] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [sendAt, setSendAt] = useState('');
  const [offset, setOffset] = useState<ScheduleOffsetChoice>('custom');
  const [error, setError] = useState<string | null>(null);
  const [filledFor, setFilledFor] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ['admin-events-catalog', 'notifiable'],
    queryFn: async () => {
      const data = await adminFetch<{ items: EventOption[] }>('/events');
      return { items: data.items.filter((item) => canAdminNotifyEvent(item.status)) };
    },
  });

  const selected = (events.data?.items ?? []).find((event) => event.id === eventId) ?? null;

  if (selected && filledFor !== selected.id) {
    const copy =
      offset === 'published'
        ? publishedPushCopy(selected.title)
        : offset === 'custom'
          ? defaultPushMessageCopy(selected.title)
          : reminderPushCopy(selected.title, offset);
    setTitleSv(copy.titleSv);
    setBodySv(copy.bodySv);
    setTitleEn(copy.titleEn);
    setBodyEn(copy.bodyEn);
    if (offset === 'published') setSendAt('');
    else if (isReminderOffset(offset) && selected.startsAt) {
      setSendAt(localSendAt(offsetBeforeEventStart(new Date(selected.startsAt), offset)));
    }
    setFilledFor(selected.id);
  }

  function applyOffset(next: ScheduleOffsetChoice, event = selected) {
    setOffset(next);
    if (!event) return;
    const defaults = defaultPushMessageCopy(event.title);
    const previous =
      offset === 'published'
        ? publishedPushCopy(event.title)
        : isReminderOffset(offset)
          ? reminderPushCopy(event.title, offset)
          : null;
    const same = (copy: { titleSv: string; bodySv: string; titleEn: string; bodyEn: string }) =>
      titleSv === copy.titleSv &&
      bodySv === copy.bodySv &&
      titleEn === copy.titleEn &&
      bodyEn === copy.bodyEn;
    const untouched = same(defaults) || (previous !== null && same(previous));
    if (next === 'published') {
      setSendAt('');
      if (untouched) {
        const copy = publishedPushCopy(event.title);
        setTitleSv(copy.titleSv);
        setBodySv(copy.bodySv);
        setTitleEn(copy.titleEn);
        setBodyEn(copy.bodyEn);
      }
      return;
    }
    if (next === 'custom' || !event.startsAt || !isReminderOffset(next)) return;
    setSendAt(localSendAt(offsetBeforeEventStart(new Date(event.startsAt), next)));
    if (untouched) {
      const copy = reminderPushCopy(event.title, next);
      setTitleSv(copy.titleSv);
      setBodySv(copy.bodySv);
      setTitleEn(copy.titleEn);
      setBodyEn(copy.bodyEn);
    }
  }

  const create = useMutation({
    mutationFn: () =>
      adminFetch<PushMessage>('/push-messages/event', {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          audience,
          titleSv,
          bodySv,
          titleEn,
          bodyEn,
          sendAt: sendAt ? new Date(sendAt).toISOString() : null,
        }),
      }),
    onSuccess: async (row) => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
      router.push(`/push-messages/${row.id}`);
    },
    onError: (err) => {
      if (err instanceof AdminApiError && err.code === 'push_draft_exists') {
        setError(t('eventDraftExists'));
        return;
      }
      if (err instanceof AdminApiError && err.code === 'event_not_published') {
        setError(t('eventNotPublished'));
        return;
      }
      setError(t('eventCreateError'));
    },
  });

  const canSubmit =
    Boolean(eventId) &&
    Boolean(titleSv.trim()) &&
    Boolean(bodySv.trim()) &&
    Boolean(titleEn.trim()) &&
    Boolean(bodyEn.trim()) &&
    !create.isPending;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link
        href="/push-messages"
        className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'self-start' })}
      >
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('eventTitle')}</h1>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {events.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{t('eventLoadError')}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="event-push-picker">{t('eventPicker')}</FieldLabel>
            <Combobox
              items={events.data?.items ?? []}
              value={selected}
              onValueChange={(value) => setEventId(value?.id ?? '')}
              itemToStringLabel={(item) => item.title}
              itemToStringValue={(item) => item.id}
              isItemEqualToValue={(item, value) => item.id === value.id}
            >
              <ComboboxInput
                id="event-push-picker"
                placeholder={t('eventPicker')}
                disabled={events.isLoading}
                showClear
                className="w-full"
                required
              />
              <ComboboxContent>
                <ComboboxEmpty>{events.isLoading ? '…' : '—'}</ComboboxEmpty>
                <ComboboxList>
                  {(option: EventOption) => (
                    <ComboboxItem key={option.id} value={option}>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm">{option.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.publisherName}
                          {' · '}
                          {option.startsAt ? new Date(option.startsAt).toLocaleString() : '—'}
                          {option.status === 'published' ? '' : ` · ${t('heldUntilPublished')}`}
                        </span>
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Field>
          {selected && selected.status !== 'published' ? (
            <Alert>
              <AlertDescription>{t('planHeld')}</AlertDescription>
            </Alert>
          ) : null}
          <FieldSet>
            <FieldLegend variant="label" id="event-push-audience-label">
              {t('audienceRule')}
            </FieldLegend>
            <RadioGroup
              aria-labelledby="event-push-audience-label"
              value={audience}
              onValueChange={(next) => {
                if (next === 'area' || next === 'area_and_tag') setAudience(next);
              }}
            >
              <Field orientation="horizontal">
                <RadioGroupItem value="area" id="event-push-audience-area" />
                <FieldLabel htmlFor="event-push-audience-area">{t('audienceArea')}</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="area_and_tag" id="event-push-audience-area-tag" />
                <FieldLabel htmlFor="event-push-audience-area-tag">
                  {t('audienceAreaAndTag')}
                </FieldLabel>
              </Field>
            </RadioGroup>
            <p className="text-sm">{t('eventAudienceLead')}</p>
            <FieldDescription>
              {audience === 'area' ? t('eventAudienceArea') : t('eventAudienceAreaAndTag')}
            </FieldDescription>
            <FieldDescription>{t('eventHint')}</FieldDescription>
          </FieldSet>
          <Field>
            <FieldLabel htmlFor="event-push-title-sv">{t('titleSv')}</FieldLabel>
            <Input
              id="event-push-title-sv"
              value={titleSv}
              onChange={(event) => setTitleSv(event.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-push-body-sv">{t('bodySv')}</FieldLabel>
            <Textarea
              id="event-push-body-sv"
              value={bodySv}
              onChange={(event) => setBodySv(event.target.value)}
              required
              rows={2}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-push-title-en">{t('titleEn')}</FieldLabel>
            <Input
              id="event-push-title-en"
              value={titleEn}
              onChange={(event) => setTitleEn(event.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-push-body-en">{t('bodyEn')}</FieldLabel>
            <Textarea
              id="event-push-body-en"
              value={bodyEn}
              onChange={(event) => setBodyEn(event.target.value)}
              required
              rows={2}
            />
          </Field>
          <PushScheduleOffsetSelect
            id="event-push-offset"
            value={offset}
            allowPublished
            disabled={!selected}
            onChange={(next) => applyOffset(next)}
          />
          {offset === 'published' ? (
            <FieldDescription>{t('offsetPublishedHint')}</FieldDescription>
          ) : (
            <Field>
              <FieldLabel htmlFor="event-push-send-at">{t('sendAt')}</FieldLabel>
              <Input
                id="event-push-send-at"
                type="datetime-local"
                value={sendAt}
                onChange={(event) => {
                  setSendAt(event.target.value);
                  setOffset('custom');
                }}
              />
              <FieldDescription>{t('eventSendAtHint')}</FieldDescription>
            </Field>
          )}
          <div className="flex gap-2">
            <Button onClick={() => create.mutate()} disabled={!canSubmit}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('eventCreate')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
