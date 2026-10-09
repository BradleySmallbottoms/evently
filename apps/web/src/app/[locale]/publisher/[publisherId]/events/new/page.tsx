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
import { Suspense, useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { useRouter } from '@/i18n/navigation';
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
};

function NewEventInner() {
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
      const formData = new FormData(event.currentTarget);
      const categoryIds = formData.getAll('categoryIds').map(String);
      const startsAt = String(formData.get('startsAt') ?? '');
      const endsAt = String(formData.get('endsAt') ?? '');
      const modeValue = (
        String(formData.get('mode') ?? 'physical') === 'digital' ? 'digital' : 'physical'
      ) as EventMode;

      const latRaw = String(formData.get('lat') ?? '').trim();
      const lngRaw = String(formData.get('lng') ?? '').trim();
      const radiusRaw = String(formData.get('geofenceRadiusM') ?? '').trim();
      const location =
        modeValue === 'physical' && latRaw && lngRaw
          ? { lat: Number(latRaw), lng: Number(lngRaw) }
          : undefined;

      const result = await api.POST('/publishers/{publisherId}/events', {
        params: { path: { publisherId } },
        body: {
          title: String(formData.get('title') ?? ''),
          description: String(formData.get('description') ?? '').trim() || undefined,
          mode: modeValue,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          timezone: String(formData.get('timezone') ?? 'Europe/Stockholm'),
          venueName: String(formData.get('venueName') ?? '').trim() || undefined,
          location,
          geofenceRadiusM:
            modeValue === 'physical' && radiusRaw ? Math.round(Number(radiusRaw)) : undefined,
          onlineUrl:
            modeValue === 'digital'
              ? String(formData.get('onlineUrl') ?? '').trim() || undefined
              : undefined,
          categoryIds,
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
        <TextField
          name="title"
          label={t('title')}
          required
          fullWidth
          slotProps={{ htmlInput: { minLength: 2 } }}
        />
        <TextField
          name="description"
          label={t('description')}
          fullWidth
          multiline
          minRows={4}
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
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            name="endsAt"
            label={t('endsAt')}
            type="datetime-local"
            required
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        <TextField
          name="timezone"
          label={t('timezone')}
          defaultValue="Europe/Stockholm"
          fullWidth
        />

        {mode === 'physical' ? (
          <Paper variant="outlined" sx={styles.section}>
            <Typography variant="overline" color="text.secondary">
              {t('physicalDetails')}
            </Typography>
            <TextField name="venueName" label={t('venueName')} fullWidth />
            <Stack sx={styles.grid2}>
              <TextField
                name="lat"
                label={t('latitude')}
                type="number"
                fullWidth
                slotProps={{ htmlInput: { step: '0.000001' } }}
              />
              <TextField
                name="lng"
                label={t('longitude')}
                type="number"
                fullWidth
                slotProps={{ htmlInput: { step: '0.000001' } }}
              />
            </Stack>
            <TextField
              name="geofenceRadiusM"
              label={t('geofenceRadiusM')}
              type="number"
              fullWidth
              slotProps={{ htmlInput: { min: 10, max: 5000 } }}
            />
          </Paper>
        ) : (
          <TextField name="onlineUrl" label={t('onlineUrl')} type="url" fullWidth />
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
            defaultValue={[]}
            inputProps={{ id: 'categories' }}
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

export default function NewPublisherEventPage() {
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
          <NewEventInner />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
