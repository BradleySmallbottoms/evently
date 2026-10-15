'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link as AppLink } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';
import { toDatetimeLocal, zonedLocalToIso } from '@/lib/zoned-datetime';
import { EventImages } from './event-images';
import { EventNotifications } from './event-notifications';
import { EventTagsField } from './event-tags-field';

type EventMode = 'physical' | 'digital';
type EventStatus =
  'draft' | 'awaiting_verification' | 'in_review' | 'published' | 'cancelled' | 'ended';
type LinkType = 'tickets' | 'registration' | 'info';

type EventDetail = {
  id: string;
  publisherId: string;
  publisherName: string;
  title: string;
  description: string | null;
  mode: EventMode;
  status: EventStatus;
  origin: 'native' | 'imported';
  startsAt: string;
  endsAt: string;
  timezone: string;
  venueName: string | null;
  location: { lat: number; lng: number } | null;
  geofenceRadiusM: number | null;
  onlineUrl: string | null;
  priceAmount: number | null;
  currency: string;
  sourceUrl: string | null;
  refId: string | null;
  workerId: string | null;
  meta: {
    possibleDuplicate?: {
      eventId: string;
      title: string;
      startsAt: string;
      refId: string | null;
      workerId: string | null;
      matchedOn: 'title' | 'link' | 'id';
    };
  };
  tagIds: string[];
  featured: boolean;
  checkInEnabled: boolean;
  imageUrl: string | null;
  imageUrls: string[];
  links: { type: LinkType; url: string; label: string | null }[];
  createdAt: string;
  updatedAt: string;
};

type TagOption = { id: string; name: string };

type DraftLink = { type: LinkType; url: string; label: string };

type Draft = {
  title: string;
  description: string;
  mode: EventMode;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venueName: string;
  lat: string;
  lng: string;
  geofenceRadiusM: string;
  onlineUrl: string;
  priceAmount: string;
  currency: string;
  tagIds: string[];
  links: DraftLink[];
  featured: boolean;
  checkInEnabled: boolean;
};

const STATUSES: EventStatus[] = [
  'draft',
  'awaiting_verification',
  'in_review',
  'published',
  'cancelled',
  'ended',
];

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

type EditorTab = 'info' | 'location' | 'notifications';

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return value;
  } catch {
    return null;
  }
  return null;
}

function toDraft(event: EventDetail): Draft {
  return {
    title: event.title,
    description: event.description ?? '',
    mode: event.mode,
    status: event.status,
    startsAt: toDatetimeLocal(event.startsAt, event.timezone),
    endsAt: toDatetimeLocal(event.endsAt, event.timezone),
    timezone: event.timezone,
    venueName: event.venueName ?? '',
    lat: event.location ? String(event.location.lat) : '',
    lng: event.location ? String(event.location.lng) : '',
    geofenceRadiusM: event.geofenceRadiusM == null ? '' : String(event.geofenceRadiusM),
    onlineUrl: event.onlineUrl ?? '',
    priceAmount: event.priceAmount == null ? '' : String(event.priceAmount),
    currency: event.currency,
    tagIds: event.tagIds,
    featured: event.featured,
    checkInEnabled: event.checkInEnabled,
    links: event.links.map((link) => ({
      type: link.type,
      url: link.url,
      label: link.label ?? '',
    })),
  };
}

export function EventEditor({ eventId }: { eventId: string }) {
  const t = useTranslations('EventEditor');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [eventKey, setEventKey] = useState(eventId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<EditorTab>('info');
  if (eventKey !== eventId) {
    setEventKey(eventId);
    setDraft(null);
    setNotice(null);
    setFormError(null);
    setTab('info');
  }

  const eventQuery = useQuery({
    queryKey: ['admin-event', eventId],
    queryFn: () => adminFetch<EventDetail>(`/events/${eventId}`),
    retry: false,
  });

  const categories = useQuery({
    queryKey: ['admin-tags'],
    queryFn: () => adminFetch<{ items: TagOption[] }>('/tags'),
    retry: false,
  });

  const form =
    draft ?? (eventQuery.data && eventQuery.data.id === eventId ? toDraft(eventQuery.data) : null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminFetch<EventDetail>(`/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: async (saved) => {
      setDraft(toDraft(saved));
      setNotice(t('saved'));
      setFormError(null);
      queryClient.setQueryData(['admin-event', eventId], saved);
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
  });

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (!form) return;
    setDraft({ ...form, [key]: value });
  }

  function onSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!form) return;
    setNotice(null);
    setFormError(null);
    const latRaw = form.lat.trim();
    const lngRaw = form.lng.trim();
    if ((latRaw === '') !== (lngRaw === '')) {
      setFormError(t('invalidLocation'));
      return;
    }
    const location = latRaw && lngRaw ? { lat: Number(latRaw), lng: Number(lngRaw) } : null;
    if (location && (!Number.isFinite(location.lat) || !Number.isFinite(location.lng))) {
      setFormError(t('invalidLocation'));
      return;
    }
    const priceRaw = form.priceAmount.trim();
    if (priceRaw !== '' && !/^\d+$/.test(priceRaw)) {
      setFormError(t('invalidPrice'));
      return;
    }
    const radiusRaw = form.geofenceRadiusM.trim();
    if (radiusRaw !== '' && !/^\d+$/.test(radiusRaw)) {
      setFormError(t('invalidRadius'));
      return;
    }
    const links = form.links
      .map((link) => ({
        type: link.type,
        url: link.url.trim(),
        label: link.label.trim(),
      }))
      .filter((link) => link.url || link.label);
    if (links.some((link) => !link.url)) {
      setFormError(t('invalidLink'));
      return;
    }
    let startsAt: string;
    let endsAt: string;
    try {
      startsAt = zonedLocalToIso(form.startsAt, form.timezone.trim() || 'Europe/Stockholm');
      endsAt = zonedLocalToIso(form.endsAt, form.timezone.trim() || 'Europe/Stockholm');
    } catch {
      setFormError(t('invalidTime'));
      return;
    }
    save.mutate({
      title: form.title.trim(),
      description: form.description.trim() || null,
      mode: form.mode,
      status: form.status,
      startsAt,
      endsAt,
      timezone: form.timezone.trim() || 'Europe/Stockholm',
      venueName: form.venueName.trim() || null,
      location,
      geofenceRadiusM: radiusRaw === '' ? null : Number(radiusRaw),
      onlineUrl: form.onlineUrl.trim() || null,
      priceAmount: priceRaw === '' ? null : Number(priceRaw),
      currency: form.currency.trim() || 'SEK',
      tagIds: form.tagIds,
      featured: form.featured,
      checkInEnabled: form.checkInEnabled,
      links: links.map((link) => ({
        type: link.type,
        url: link.url,
        ...(link.label ? { label: link.label } : {}),
      })),
    });
  }

  if (eventQuery.isError) {
    const unauthorized =
      eventQuery.error instanceof AdminApiError && eventQuery.error.status === 401;
    const missing = eventQuery.error instanceof AdminApiError && eventQuery.error.status === 404;
    return (
      <Alert severity={unauthorized ? 'info' : 'error'}>
        {unauthorized ? (
          <>
            {t('needLogin')} <AppLink href="/login">{tApp('navLogin')}</AppLink>
          </>
        ) : missing ? (
          t('notFound')
        ) : (
          t('loadError')
        )}
      </Alert>
    );
  }

  if (!form || eventQuery.isLoading) {
    return <Typography color="text.secondary">{tApp('loading')}</Typography>;
  }

  const event = eventQuery.data;
  const source = httpUrl(event?.sourceUrl ?? null);
  const saveError =
    formError ??
    (save.isError
      ? save.error instanceof AdminApiError && save.error.code === 'online_url_required'
        ? t('onlineRequired')
        : save.error instanceof AdminApiError && save.error.code === 'invalid_event'
          ? t('invalidEvent')
          : t('saveError')
      : null);

  const saveButton = (
    <Button
      type="submit"
      variant="contained"
      disabled={save.isPending}
      sx={{ alignSelf: 'flex-start' }}
    >
      {save.isPending ? t('saving') : t('save')}
    </Button>
  );

  return (
    <Stack spacing={2}>
      <Button component={AppLink} href="/events/manage" sx={{ alignSelf: 'flex-start' }}>
        {t('back')}
      </Button>
      <Typography variant="h4" component="h1">
        {t('title')}
      </Typography>
      {event ? (
        <Typography variant="body2" color="text.secondary">
          {t('publisher')}:{' '}
          <AppLink href={`/publishers/${event.publisherId}`}>{event.publisherName}</AppLink>
          {' · '}
          {t('origin')}: {event.origin}
          {source ? (
            <>
              {' · '}
              <Link href={source} target="_blank" rel="noopener noreferrer">
                {t('source')}
              </Link>
            </>
          ) : null}
        </Typography>
      ) : null}
      {event?.meta.possibleDuplicate ? (
        <Alert severity="warning">
          {event.meta.possibleDuplicate.workerId || event.meta.possibleDuplicate.refId
            ? t('possibleDuplicate', {
                matchedOn: event.meta.possibleDuplicate.matchedOn,
                worker: event.meta.possibleDuplicate.workerId ?? '',
                ref: event.meta.possibleDuplicate.refId ?? '',
              })
            : t('possibleDuplicateSame', {
                matchedOn: event.meta.possibleDuplicate.matchedOn,
              })}{' '}
          <AppLink href={`/events/${event.meta.possibleDuplicate.eventId}`}>
            {event.meta.possibleDuplicate.title}
          </AppLink>
        </Alert>
      ) : null}
      <Tabs
        value={tab}
        onChange={(_event, value: EditorTab) => setTab(value)}
        aria-label={t('tabsLabel')}
      >
        <Tab value="info" label={t('tabInfo')} />
        <Tab value="location" label={t('tabLocation')} />
        <Tab value="notifications" label={t('tabNotifications')} />
      </Tabs>
      {tab === 'notifications' && event ? (
        <EventNotifications
          eventId={eventId}
          title={event.title}
          startsAt={event.startsAt}
          timezone={event.timezone}
          status={event.status}
        />
      ) : (
        <Stack component="form" spacing={2} onSubmit={onSubmit}>
          {notice ? <Alert severity="success">{notice}</Alert> : null}
          {saveError ? <Alert severity="error">{saveError}</Alert> : null}
          {tab === 'info' ? (
            <>
              <EventImages imageUrl={event?.imageUrl ?? null} imageUrls={event?.imageUrls ?? []} />
              <TextField
                label={t('name')}
                required
                fullWidth
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
              />
              <TextField
                label={t('description')}
                fullWidth
                multiline
                minRows={4}
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
              />
              <Stack sx={styles.grid2}>
                <FormControl fullWidth>
                  <InputLabel id="event-mode-label">{t('mode')}</InputLabel>
                  <Select
                    labelId="event-mode-label"
                    label={t('mode')}
                    value={form.mode}
                    onChange={(e) =>
                      update('mode', e.target.value === 'digital' ? 'digital' : 'physical')
                    }
                  >
                    <MenuItem value="physical">{t('modePhysical')}</MenuItem>
                    <MenuItem value="digital">{t('modeDigital')}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel id="event-status-label">{t('status')}</InputLabel>
                  <Select
                    labelId="event-status-label"
                    label={t('status')}
                    value={form.status}
                    onChange={(e) => update('status', e.target.value as EventStatus)}
                  >
                    {STATUSES.map((status) => (
                      <MenuItem key={status} value={status}>
                        {t(
                          status === 'awaiting_verification'
                            ? 'statusAwaiting'
                            : status === 'in_review'
                              ? 'statusInReview'
                              : status === 'draft'
                                ? 'statusDraft'
                                : status === 'published'
                                  ? 'statusPublished'
                                  : status === 'cancelled'
                                    ? 'statusCancelled'
                                    : 'statusEnded',
                        )}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.featured}
                    onChange={(_event, checked) => update('featured', checked)}
                  />
                }
                label={t('featured')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.checkInEnabled}
                    onChange={(_event, checked) => update('checkInEnabled', checked)}
                  />
                }
                label={t('checkInEnabled')}
              />
              <Stack sx={styles.grid2}>
                <TextField
                  label={t('startsAt')}
                  type="datetime-local"
                  required
                  fullWidth
                  value={form.startsAt}
                  onChange={(e) => update('startsAt', e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label={t('endsAt')}
                  type="datetime-local"
                  required
                  fullWidth
                  value={form.endsAt}
                  onChange={(e) => update('endsAt', e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
              <TextField
                label={t('timezone')}
                required
                fullWidth
                value={form.timezone}
                onChange={(e) => update('timezone', e.target.value)}
                helperText={t('timezoneHint')}
              />
              <Stack sx={styles.grid2}>
                <TextField
                  label={t('priceAmount')}
                  fullWidth
                  value={form.priceAmount}
                  onChange={(e) => update('priceAmount', e.target.value)}
                  helperText={t('priceHint')}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                />
                <TextField
                  label={t('currency')}
                  fullWidth
                  value={form.currency}
                  onChange={(e) => update('currency', e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 3 } }}
                />
              </Stack>
              <EventTagsField
                tags={categories.data?.items ?? []}
                selectedIds={form.tagIds}
                disabled={categories.isLoading || categories.isError}
                onChange={(ids) => update('tagIds', ids)}
              />
              <Paper variant="outlined" sx={styles.section}>
                <Typography variant="overline" color="text.secondary">
                  {t('links')}
                </Typography>
                {form.links.map((link, index) => (
                  <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <FormControl sx={{ minWidth: 160 }}>
                      <InputLabel id={`link-type-${index}`}>{t('linkType')}</InputLabel>
                      <Select
                        labelId={`link-type-${index}`}
                        label={t('linkType')}
                        value={link.type}
                        onChange={(e) => {
                          const type = e.target.value as LinkType;
                          update(
                            'links',
                            form.links.map((item, i) => (i === index ? { ...item, type } : item)),
                          );
                        }}
                      >
                        <MenuItem value="tickets">{t('linkTickets')}</MenuItem>
                        <MenuItem value="registration">{t('linkRegistration')}</MenuItem>
                        <MenuItem value="info">{t('linkInfo')}</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      label={t('linkUrl')}
                      fullWidth
                      value={link.url}
                      onChange={(e) =>
                        update(
                          'links',
                          form.links.map((item, i) =>
                            i === index ? { ...item, url: e.target.value } : item,
                          ),
                        )
                      }
                    />
                    <TextField
                      label={t('linkLabel')}
                      value={link.label}
                      onChange={(e) =>
                        update(
                          'links',
                          form.links.map((item, i) =>
                            i === index ? { ...item, label: e.target.value } : item,
                          ),
                        )
                      }
                    />
                    <IconButton
                      aria-label={t('removeLink')}
                      onClick={() =>
                        update(
                          'links',
                          form.links.filter((_, i) => i !== index),
                        )
                      }
                    >
                      ×
                    </IconButton>
                  </Stack>
                ))}
                <Button
                  type="button"
                  onClick={() =>
                    update('links', [...form.links, { type: 'info', url: '', label: '' }])
                  }
                >
                  {t('addLink')}
                </Button>
              </Paper>
              {saveButton}
            </>
          ) : (
            <>
              {form.mode === 'physical' ? (
                <Paper variant="outlined" sx={styles.section}>
                  <Typography variant="overline" color="text.secondary">
                    {t('physicalDetails')}
                  </Typography>
                  <TextField
                    label={t('venueName')}
                    fullWidth
                    value={form.venueName}
                    onChange={(e) => update('venueName', e.target.value)}
                  />
                  <Stack sx={styles.grid2}>
                    <TextField
                      label={t('latitude')}
                      fullWidth
                      value={form.lat}
                      onChange={(e) => update('lat', e.target.value)}
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                    <TextField
                      label={t('longitude')}
                      fullWidth
                      value={form.lng}
                      onChange={(e) => update('lng', e.target.value)}
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                  </Stack>
                  <TextField
                    label={t('geofenceRadiusM')}
                    fullWidth
                    value={form.geofenceRadiusM}
                    onChange={(e) => update('geofenceRadiusM', e.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                  />
                </Paper>
              ) : (
                <TextField
                  label={t('onlineUrl')}
                  type="url"
                  required
                  fullWidth
                  value={form.onlineUrl}
                  onChange={(e) => update('onlineUrl', e.target.value)}
                />
              )}
              {saveButton}
            </>
          )}
        </Stack>
      )}
    </Stack>
  );
}
