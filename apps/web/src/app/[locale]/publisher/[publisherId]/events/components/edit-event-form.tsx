'use client';

import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { API_URL, api, throwIfError } from '@/lib/api';
import { DigitalCodePanel } from './digital-code-panel';
import { EventContentPanel } from './event-content-panel';
import { SentNotifications } from './sent-notifications';
import { ManagedEventFields, readManagedEventForm, type EventMode } from './managed-event-fields';

const textLinkClass = 'text-sm underline-offset-4 hover:underline';

function toInputDatetime(iso: string): string {
  return iso.slice(0, 16);
}

export function EditEventForm() {
  const t = useTranslations('Events');
  const { publisherId, eventId } = useParams<{ publisherId: string; eventId: string }>();
  const [pendingSave, setPendingSave] = useState(false);
  const [pendingPublish, setPendingPublish] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(false);
  const [pendingNotify, setPendingNotify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<EventMode>('physical');

  const categories = useQuery({
    queryKey: ['tags'],
    queryFn: async () => throwIfError(await api.GET('/tags')),
  });

  const eventQuery = useQuery({
    queryKey: ['managed-event', eventId],
    queryFn: async () =>
      throwIfError(
        await api.GET('/manage/events/{id}', {
          params: { path: { id: eventId } },
        }),
      ),
    retry: false,
  });

  const pushDraft = useQuery({
    queryKey: ['event-push-draft', eventId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/manage/events/${eventId}/push-message`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('push_draft_load_failed');
      return (await res.json()) as {
        pushMessage: {
          id: string;
          status: string;
        } | null;
      };
    },
    enabled: Boolean(eventId),
    retry: false,
  });

  const publisherStats = useQuery({
    queryKey: ['publisher-stats', publisherId],
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const key of ['numPublishedEvents', 'numCheckins', 'numRatings', 'totalRatingValue']) {
        params.append('key', key);
      }
      const res = await fetch(`${API_URL}/stats/publisher/${publisherId}?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`stats_${res.status}`);
      const body = (await res.json()) as { items: { key: string; value: number }[] };
      const map = Object.fromEntries((body.items ?? []).map((i) => [i.key, i.value]));
      const numRatings = map.numRatings ?? 0;
      const total = map.totalRatingValue ?? 0;
      return {
        numPublishedEvents: map.numPublishedEvents ?? 0,
        numCheckins: map.numCheckins ?? 0,
        numRatings,
        ratingAverage: numRatings > 0 ? Math.round((total / numRatings) * 10) / 10 : null,
      };
    },
    retry: false,
  });

  const eventStats = useQuery({
    queryKey: ['event-stats', eventId],
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const key of ['numCheckins', 'numRatings', 'totalRatingValue']) {
        params.append('key', key);
      }
      const res = await fetch(`${API_URL}/stats/event/${eventId}?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`stats_${res.status}`);
      const body = (await res.json()) as { items: { key: string; value: number }[] };
      const map = Object.fromEntries((body.items ?? []).map((i) => [i.key, i.value]));
      const numRatings = map.numRatings ?? 0;
      const total = map.totalRatingValue ?? 0;
      return {
        numCheckins: map.numCheckins ?? 0,
        numRatings,
        ratingAverage: numRatings > 0 ? Math.round((total / numRatings) * 10) / 10 : null,
      };
    },
    enabled: eventQuery.data?.status === 'published',
    retry: false,
  });

  const event = eventQuery.data;
  const [attendeeText, setAttendeeText] = useState('');
  const [attendeeLinks, setAttendeeLinks] = useState<{ url: string; label: string }[]>([
    { url: '', label: '' },
  ]);
  const [attendeeEventId, setAttendeeEventId] = useState<string | null>(null);
  const [modeEvent, setModeEvent] = useState<typeof event>(undefined);
  if (event && event !== modeEvent) {
    setModeEvent(event);
    setMode(event.mode);
  }
  if (event && attendeeEventId !== event.id) {
    setAttendeeEventId(event.id);
    setAttendeeText(event.attendeeText ?? '');
    setAttendeeLinks(
      event.attendeeLinks.length > 0
        ? event.attendeeLinks.map((link) => ({ url: link.url, label: link.label ?? '' }))
        : [{ url: '', label: '' }],
    );
  }

  async function save(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setPendingSave(true);
    setError(null);
    setNotice(null);
    try {
      const fields = readManagedEventForm(new FormData(formEvent.currentTarget));
      throwIfError(
        await api.PATCH('/manage/events/{id}', {
          params: { path: { id: eventId } },
          body: {
            title: fields.title,
            description: fields.description || null,
            mode: fields.mode,
            startsAt: new Date(fields.startsAt).toISOString(),
            endsAt: new Date(fields.endsAt).toISOString(),
            timezone: fields.timezone,
            venueName: fields.venueName || null,
            location: fields.location ?? null,
            geofenceRadiusM: fields.geofenceRadiusM ?? null,
            onlineUrl: fields.onlineUrl ?? null,
            tagIds: fields.tagIds,
            ...(event?.checkInEnabled
              ? {
                  attendeeText: attendeeText.trim() || null,
                  attendeeLinks: attendeeLinks
                    .map((link) => ({ url: link.url.trim(), label: link.label.trim() }))
                    .filter((link) => link.url)
                    .map((link) => ({
                      url: link.url,
                      ...(link.label ? { label: link.label } : {}),
                    })),
                }
              : {}),
          },
        }),
      );
      await eventQuery.refetch();
      setNotice(t('saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setPendingSave(false);
    }
  }

  async function publish() {
    setPendingPublish(true);
    setError(null);
    setNotice(null);
    try {
      const updated = throwIfError(
        await api.POST('/manage/events/{id}/publish', {
          params: { path: { id: eventId } },
        }),
      );
      await eventQuery.refetch();
      if (updated.status === 'awaiting_verification') {
        setNotice(t('awaitingVerificationNotice'));
      } else {
        setNotice(t('published'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('publishError'));
    } finally {
      setPendingPublish(false);
    }
  }

  async function cancel() {
    setPendingCancel(true);
    setError(null);
    setNotice(null);
    try {
      throwIfError(
        await api.POST('/manage/events/{id}/cancel', {
          params: { path: { id: eventId } },
        }),
      );
      await eventQuery.refetch();
      setNotice(t('cancelled'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cancelError'));
    } finally {
      setPendingCancel(false);
    }
  }

  async function notifyAgain() {
    setPendingNotify(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/manage/events/${eventId}/push-message`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('notify_failed');
      await pushDraft.refetch();
      setNotice(t('notifyAgainCreated'));
    } catch {
      setError(t('notifyAgainError'));
    } finally {
      setPendingNotify(false);
    }
  }

  if (eventQuery.isPending) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (eventQuery.isError || !event) {
    return <p className="text-sm text-destructive">{t('loadError')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{event.title}</h1>
        <p className="text-sm text-muted-foreground">
          {t('currentStatus')}: {t(`status.${event.status}`)}
        </p>
        {publisherStats.data ? (
          <p className="text-sm text-muted-foreground">
            {t('publisherStatsLine', {
              published: publisherStats.data.numPublishedEvents,
              checkIns: publisherStats.data.numCheckins,
              average: publisherStats.data.ratingAverage ?? '–',
              ratings: publisherStats.data.numRatings,
            })}
          </p>
        ) : null}
        {eventStats.data ? (
          <p className="text-sm text-muted-foreground">
            {t('eventStatsLine', {
              checkIns: eventStats.data.numCheckins,
              average: eventStats.data.ratingAverage ?? '–',
              ratings: eventStats.data.numRatings,
            })}
          </p>
        ) : null}
      </div>
      <form onSubmit={save} className="flex flex-col gap-4">
        <ManagedEventFields
          mode={mode}
          onModeChange={setMode}
          categories={categories.data?.items}
          categoriesLoading={categories.isPending}
          categoriesError={categories.isError}
          categoriesInputId="categories-edit"
          values={{
            title: event.title,
            description: event.description,
            mode: event.mode,
            startsAt: toInputDatetime(event.startsAt),
            endsAt: toInputDatetime(event.endsAt),
            timezone: event.timezone,
            venueName: event.venueName,
            lat: event.location?.lat,
            lng: event.location?.lng,
            geofenceRadiusM: event.geofenceRadiusM,
            onlineUrl: event.onlineUrl,
            tagIds: event.tagIds,
          }}
        />
        {event.checkInEnabled ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-foreground">{t('attendeeTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('attendeeHelp')}</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="attendee-text">{t('attendeeText')}</Label>
              <Textarea
                id="attendee-text"
                value={attendeeText}
                onChange={(e) => setAttendeeText(e.target.value)}
                rows={3}
              />
            </div>
            {attendeeLinks.map((link, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor={`attendee-link-url-${index}`}>{t('attendeeLinkUrl')}</Label>
                  <Input
                    id={`attendee-link-url-${index}`}
                    value={link.url}
                    onChange={(e) =>
                      setAttendeeLinks((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, url: e.target.value } : item,
                        ),
                      )
                    }
                  />
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor={`attendee-link-label-${index}`}>{t('attendeeLinkLabel')}</Label>
                  <Input
                    id={`attendee-link-label-${index}`}
                    value={link.label}
                    onChange={(e) =>
                      setAttendeeLinks((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, label: e.target.value } : item,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('attendeeLinkRemove')}
                  onClick={() =>
                    setAttendeeLinks((current) =>
                      current.length === 1
                        ? [{ url: '', label: '' }]
                        : current.filter((_, i) => i !== index),
                    )
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAttendeeLinks((current) => [...current, { url: '', label: '' }])}
            >
              {t('attendeeLinkAdd')}
            </Button>
          </div>
        ) : null}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <SentNotifications eventId={eventId} />
        {pushDraft.data?.pushMessage ? (
          <Alert>
            <AlertDescription>
              {t('pushDraftStatus', { status: pushDraft.data.pushMessage.status })}
            </AlertDescription>
          </Alert>
        ) : null}
        {!pushDraft.data?.pushMessage &&
        (event.status === 'published' ||
          event.status === 'awaiting_verification' ||
          event.status === 'in_review') ? (
          <Alert>
            <AlertDescription>{t('notifyAgainHint')}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-row flex-wrap items-center gap-3">
          <Button type="submit" variant="brand" disabled={pendingSave}>
            {t('saveChanges')}
          </Button>
          <Button type="button" variant="outline" onClick={publish} disabled={pendingPublish}>
            {t('publish')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={notifyAgain}
            disabled={
              pendingNotify ||
              Boolean(pushDraft.data?.pushMessage) ||
              event.status === 'draft' ||
              event.status === 'cancelled' ||
              event.status === 'ended'
            }
          >
            {t('notifyAgain')}
          </Button>
          <Button type="button" variant="destructive" onClick={cancel} disabled={pendingCancel}>
            {t('cancel')}
          </Button>
          <AppLink href={`/publisher/${publisherId}/events`} className={textLinkClass}>
            {t('backToEvents')}
          </AppLink>
        </div>
      </form>
      {event.checkInEnabled ? (
        <>
          <DigitalCodePanel eventId={eventId} published={event.status === 'published'} />
          <EventContentPanel eventId={eventId} />
        </>
      ) : null}
    </div>
  );
}
