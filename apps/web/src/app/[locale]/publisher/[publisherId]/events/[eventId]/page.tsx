'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { api, throwIfError } from '@/lib/api';
import { QueryProvider } from '@/lib/query-provider';

type EventMode = 'physical' | 'digital';

const styles: Record<string, SxProps<Theme>> = {
  grid2: {
    display: 'grid',
    gap: 2,
    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
  },
  section: {
    p: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
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

function EventEditorInner() {
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
      const formData = new FormData(formEvent.currentTarget);
      const startsAt = String(formData.get('startsAt') ?? '');
      const endsAt = String(formData.get('endsAt') ?? '');
      const modeValue = (
        String(formData.get('mode') ?? 'physical') === 'digital' ? 'digital' : 'physical'
      ) as EventMode;
      const latRaw = String(formData.get('lat') ?? '').trim();
      const lngRaw = String(formData.get('lng') ?? '').trim();
      const radiusRaw = String(formData.get('geofenceRadiusM') ?? '').trim();
      const categoryIds = formData.getAll('categoryIds').map(String);
      const location =
        modeValue === 'physical' && latRaw && lngRaw
          ? { lat: Number(latRaw), lng: Number(lngRaw) }
          : null;

      throwIfError(
        await api.PATCH('/manage/events/{id}', {
          params: { path: { id: eventId } },
          body: {
            title: String(formData.get('title') ?? ''),
            description: String(formData.get('description') ?? '').trim() || null,
            mode: modeValue,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            timezone: String(formData.get('timezone') ?? 'Europe/Stockholm'),
            venueName: String(formData.get('venueName') ?? '').trim() || null,
            location,
            geofenceRadiusM:
              modeValue === 'physical' && radiusRaw ? Math.round(Number(radiusRaw)) : null,
            onlineUrl:
              modeValue === 'digital'
                ? String(formData.get('onlineUrl') ?? '').trim() || null
                : null,
            categoryIds,
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
      </Stack>
      <Stack component="form" onSubmit={save} spacing={2}>
        <TextField
          name="title"
          label={t('title')}
          required
          fullWidth
          defaultValue={event.title}
          slotProps={{ htmlInput: { minLength: 2 } }}
        />
        <TextField
          name="description"
          label={t('description')}
          fullWidth
          multiline
          minRows={4}
          defaultValue={event.description ?? ''}
        />
        <FormControl fullWidth>
          <InputLabel id="event-mode-label">{t('mode')}</InputLabel>
          <Select
            labelId="event-mode-label"
            name="mode"
            label={t('mode')}
            value={mode}
            onChange={(e) =>
              setMode(e.target.value === 'digital' ? 'digital' : 'physical')
            }
          >
            <MenuItem value="physical">{t('modePhysical')}</MenuItem>
            <MenuItem value="digital">{t('modeDigital')}</MenuItem>
          </Select>
        </FormControl>
        <Stack sx={styles.grid2}>
          <TextField
            name="startsAt"
            label={t('startsAt')}
            type="datetime-local"
            required
            fullWidth
            defaultValue={toInputDatetime(event.startsAt)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            name="endsAt"
            label={t('endsAt')}
            type="datetime-local"
            required
            fullWidth
            defaultValue={toInputDatetime(event.endsAt)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        <TextField name="timezone" label={t('timezone')} defaultValue={event.timezone} fullWidth />

        {mode === 'physical' ? (
          <Paper variant="outlined" sx={styles.section}>
            <Typography variant="overline" color="text.secondary">
              {t('physicalDetails')}
            </Typography>
            <TextField
              name="venueName"
              label={t('venueName')}
              fullWidth
              defaultValue={event.venueName ?? ''}
            />
            <Stack sx={styles.grid2}>
              <TextField
                name="lat"
                label={t('latitude')}
                type="number"
                fullWidth
                defaultValue={event.location?.lat ?? ''}
                slotProps={{ htmlInput: { step: '0.000001' } }}
              />
              <TextField
                name="lng"
                label={t('longitude')}
                type="number"
                fullWidth
                defaultValue={event.location?.lng ?? ''}
                slotProps={{ htmlInput: { step: '0.000001' } }}
              />
            </Stack>
            <TextField
              name="geofenceRadiusM"
              label={t('geofenceRadiusM')}
              type="number"
              fullWidth
              defaultValue={event.geofenceRadiusM ?? ''}
              slotProps={{ htmlInput: { min: 10, max: 5000 } }}
            />
          </Paper>
        ) : (
          <TextField
            name="onlineUrl"
            label={t('onlineUrl')}
            type="url"
            fullWidth
            defaultValue={event.onlineUrl ?? ''}
          />
        )}

        <FormControl fullWidth disabled={categories.isPending || categories.isError}>
          <InputLabel id="categories-label" shrink>
            {t('categories')}
          </InputLabel>
          <Select
            labelId="categories-label"
            name="categoryIds"
            label={t('categories')}
            multiple
            native
            defaultValue={event.categoryIds}
            inputProps={{ id: 'categories-edit' }}
            sx={{ minHeight: 160 }}
          >
            {categories.data?.items.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nameSv} / {cat.nameEn}
              </option>
            ))}
          </Select>
        </FormControl>

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
    </Stack>
  );
}

export default function PublisherEventDetailPage() {
  return (
    <PageMain>
      <QueryProvider>
        <Suspense
          fallback={
            <Typography variant="body2" color="text.secondary">
              …
            </Typography>
          }
        >
          <EventEditorInner />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
