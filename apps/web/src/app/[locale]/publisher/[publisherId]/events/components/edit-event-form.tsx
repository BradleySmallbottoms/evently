'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { API_URL, api, throwIfError } from '@/lib/api';
import { DigitalCodePanel } from './digital-code-panel';
import { EventContentPanel } from './event-content-panel';
import {
  ManagedEventFields,
  readManagedEventForm,
  type EventMode,
} from './managed-event-fields';


const styles: Record<string, SxProps<Theme>> = {
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 1.5,
  },
};

function toInputDatetime(iso: string): string {
  return iso.slice(0, 16);
}

export function EditEventForm() {
  const t = useTranslations('Events');
  const { publisherId, eventId } = useParams<{ publisherId: string; eventId: string }>();
  const [pendingSave, setPendingSave] = useState(false);
  const [pendingPublish, setPendingPublish] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<EventMode>('physical');

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => throwIfError(await api.GET('/categories')),
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

  const publisherStats = useQuery({
    queryKey: ['publisher-stats', publisherId],
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const key of [
        'numPublishedEvents',
        'numCheckins',
        'numRatings',
        'totalRatingValue',
      ]) {
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
  useEffect(() => {
    if (event) setMode(event.mode);
  }, [event]);

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
            categoryIds: fields.categoryIds,
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

  if (eventQuery.isPending) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('loading')}
      </Typography>
    );
  }
  if (eventQuery.isError || !event) {
    return (
      <Typography variant="body2" color="error">
        {t('loadError')}
      </Typography>
    );
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography variant="h4" component="h1">
          {event.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('currentStatus')}: {t(`status.${event.status}`)}
        </Typography>
        {publisherStats.data ? (
          <Typography variant="body2" color="text.secondary">
            {t('publisherStatsLine', {
              published: publisherStats.data.numPublishedEvents,
              checkIns: publisherStats.data.numCheckins,
              average: publisherStats.data.ratingAverage ?? '–',
              ratings: publisherStats.data.numRatings,
            })}
          </Typography>
        ) : null}
        {eventStats.data ? (
          <Typography variant="body2" color="text.secondary">
            {t('eventStatsLine', {
              checkIns: eventStats.data.numCheckins,
              average: eventStats.data.ratingAverage ?? '–',
              ratings: eventStats.data.numRatings,
            })}
          </Typography>
        ) : null}
      </Stack>
      <Stack component="form" onSubmit={save} spacing={2}>
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
            categoryIds: event.categoryIds,
          }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Stack sx={styles.actions}>
          <Button type="submit" variant="contained" disabled={pendingSave}>
            {t('saveChanges')}
          </Button>
          <Button
            type="button"
            variant="contained"
            color="success"
            onClick={publish}
            disabled={pendingPublish}
          >
            {t('publish')}
          </Button>
          <Button
            type="button"
            variant="outlined"
            color="error"
            onClick={cancel}
            disabled={pendingCancel}
          >
            {t('cancel')}
          </Button>
          <Link
            component={AppLink}
            href={`/publisher/${publisherId}/events`}
            underline="hover"
            variant="body2"
          >
            {t('backToEvents')}
          </Link>
        </Stack>
      </Stack>
      <DigitalCodePanel eventId={eventId} published={event.status === 'published'} />
      <EventContentPanel eventId={eventId} />
    </Stack>
  );
}
