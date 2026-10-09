'use client';

import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';

export type EventMode = 'physical' | 'digital';

export type ManagedEventFieldValues = {
  title?: string;
  description?: string | null;
  mode: EventMode;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  venueName?: string | null;
  lat?: number | null;
  lng?: number | null;
  geofenceRadiusM?: number | null;
  onlineUrl?: string | null;
  categoryIds?: string[];
};

export type CategoryOption = {
  id: string;
  nameSv: string;
  nameEn: string;
};

type Props = {
  mode: EventMode;
  onModeChange: (mode: EventMode) => void;
  categories: CategoryOption[] | undefined;
  categoriesLoading: boolean;
  categoriesError: boolean;
  values?: ManagedEventFieldValues;
  categoriesInputId: string;
};

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

export function ManagedEventFields({
  mode,
  onModeChange,
  categories,
  categoriesLoading,
  categoriesError,
  values,
  categoriesInputId,
}: Props) {
  const t = useTranslations('Events');

  return (
    <>
      <TextField
        name="title"
        label={t('title')}
        required
        fullWidth
        defaultValue={values?.title ?? ''}
        slotProps={{ htmlInput: { minLength: 2 } }}
      />
      <TextField
        name="description"
        label={t('description')}
        fullWidth
        multiline
        minRows={4}
        defaultValue={values?.description ?? ''}
      />
      <FormControl fullWidth>
        <InputLabel id="event-mode-label">{t('mode')}</InputLabel>
        <Select
          labelId="event-mode-label"
          name="mode"
          label={t('mode')}
          value={mode}
          onChange={(e) => onModeChange(e.target.value === 'digital' ? 'digital' : 'physical')}
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
          defaultValue={values?.startsAt ?? ''}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          name="endsAt"
          label={t('endsAt')}
          type="datetime-local"
          required
          fullWidth
          defaultValue={values?.endsAt ?? ''}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      <TextField
        name="timezone"
        label={t('timezone')}
        defaultValue={values?.timezone ?? 'Europe/Stockholm'}
        fullWidth
      />

      {mode === 'physical' ? (
        <Paper variant="outlined" sx={styles.section}>
          <Typography variant="overline" color="text.secondary">
            {t('physicalDetails')}
          </Typography>
          <TextField
            name="venueName"
            label={t('venueName')}
            fullWidth
            defaultValue={values?.venueName ?? ''}
          />
          <Stack sx={styles.grid2}>
            <TextField
              name="lat"
              label={t('latitude')}
              type="number"
              fullWidth
              defaultValue={values?.lat ?? ''}
              slotProps={{ htmlInput: { step: '0.000001' } }}
            />
            <TextField
              name="lng"
              label={t('longitude')}
              type="number"
              fullWidth
              defaultValue={values?.lng ?? ''}
              slotProps={{ htmlInput: { step: '0.000001' } }}
            />
          </Stack>
          <TextField
            name="geofenceRadiusM"
            label={t('geofenceRadiusM')}
            type="number"
            fullWidth
            defaultValue={values?.geofenceRadiusM ?? ''}
            slotProps={{ htmlInput: { min: 10, max: 5000 } }}
          />
        </Paper>
      ) : (
        <TextField
          name="onlineUrl"
          label={t('onlineUrl')}
          type="url"
          fullWidth
          defaultValue={values?.onlineUrl ?? ''}
        />
      )}

      <FormControl fullWidth disabled={categoriesLoading || categoriesError}>
        <InputLabel id="categories-label" shrink>
          {t('categories')}
        </InputLabel>
        <Select
          labelId="categories-label"
          name="categoryIds"
          label={t('categories')}
          multiple
          native
          defaultValue={values?.categoryIds ?? []}
          inputProps={{ id: categoriesInputId }}
          sx={{ minHeight: 160 }}
        >
          {categories?.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.nameSv} / {cat.nameEn}
            </option>
          ))}
        </Select>
      </FormControl>
    </>
  );
}

/** Parse shared managed-event form fields into API-shaped values. */
export function readManagedEventForm(formData: FormData): {
  title: string;
  description: string;
  mode: EventMode;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venueName: string;
  location: { lat: number; lng: number } | undefined;
  geofenceRadiusM: number | undefined;
  onlineUrl: string | undefined;
  categoryIds: string[];
} {
  const mode: EventMode =
    String(formData.get('mode') ?? 'physical') === 'digital' ? 'digital' : 'physical';
  const latRaw = String(formData.get('lat') ?? '').trim();
  const lngRaw = String(formData.get('lng') ?? '').trim();
  const radiusRaw = String(formData.get('geofenceRadiusM') ?? '').trim();
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? '').trim(),
    mode,
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    timezone: String(formData.get('timezone') ?? 'Europe/Stockholm'),
    venueName: String(formData.get('venueName') ?? '').trim(),
    location:
      mode === 'physical' && latRaw && lngRaw
        ? { lat: Number(latRaw), lng: Number(lngRaw) }
        : undefined,
    geofenceRadiusM:
      mode === 'physical' && radiusRaw ? Math.round(Number(radiusRaw)) : undefined,
    onlineUrl:
      mode === 'digital' ? String(formData.get('onlineUrl') ?? '').trim() || undefined : undefined,
    categoryIds: formData.getAll('categoryIds').map(String),
  };
}
