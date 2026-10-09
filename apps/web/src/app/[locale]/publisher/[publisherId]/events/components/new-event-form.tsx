'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';
import {
  ManagedEventFields,
  readManagedEventForm,
  type EventMode,
} from './managed-event-fields';

export function NewEventForm() {
  const t = useTranslations('Events');
  const router = useRouter();
  const { publisherId } = useParams<{ publisherId: string }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<EventMode>('physical');

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => throwIfError(await api.GET('/categories')),
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const fields = readManagedEventForm(new FormData(event.currentTarget));
      const result = await api.POST('/publishers/{publisherId}/events', {
        params: { path: { publisherId } },
        body: {
          title: fields.title,
          description: fields.description || undefined,
          mode: fields.mode,
          startsAt: new Date(fields.startsAt).toISOString(),
          endsAt: new Date(fields.endsAt).toISOString(),
          timezone: fields.timezone,
          venueName: fields.venueName || undefined,
          location: fields.location,
          geofenceRadiusM: fields.geofenceRadiusM,
          onlineUrl: fields.onlineUrl,
          categoryIds: fields.categoryIds,
        },
      });
      const created = throwIfError(result);
      router.push(`/publisher/${publisherId}/events/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        {t('newEvent')}
      </Typography>
      <Stack component="form" onSubmit={onSubmit} spacing={2}>
        <ManagedEventFields
          mode={mode}
          onModeChange={setMode}
          categories={categories.data?.items}
          categoriesLoading={categories.isPending}
          categoriesError={categories.isError}
          categoriesInputId="categories"
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Button type="submit" variant="contained" disabled={pending}>
            {t('createDraft')}
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
