'use client';

import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { defaultPushMessageCopy } from '@local-events/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

const styles: Record<string, SxProps<Theme>> = {
  root: { display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 720 },
  panel: { p: 2, display: 'flex', flexDirection: 'column', gap: 2 },
};

type EventOption = {
  id: string;
  title: string;
  publisherName: string;
  startsAt: string;
};

type PushMessage = {
  id: string;
};

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
  const [error, setError] = useState<string | null>(null);
  const [filledFor, setFilledFor] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ['admin-events-catalog', 'published'],
    queryFn: () => adminFetch<{ items: EventOption[] }>('/events?status=published'),
  });

  const selected = (events.data?.items ?? []).find((event) => event.id === eventId) ?? null;

  useEffect(() => {
    if (!selected || filledFor === selected.id) return;
    const copy = defaultPushMessageCopy(selected.title);
    setTitleSv(copy.titleSv);
    setBodySv(copy.bodySv);
    setTitleEn(copy.titleEn);
    setBodyEn(copy.bodyEn);
    setFilledFor(selected.id);
  }, [filledFor, selected]);

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
    <Box sx={styles.root}>
      <Button component={Link} href="/push-messages" size="small" sx={{ alignSelf: 'flex-start' }}>
        {t('back')}
      </Button>
      <Typography variant="h5">{t('eventTitle')}</Typography>
      <Paper sx={styles.panel} variant="outlined">
        {error ? <Alert severity="error">{error}</Alert> : null}
        {events.isError ? <Alert severity="error">{t('eventLoadError')}</Alert> : null}
        <Autocomplete
          options={events.data?.items ?? []}
          value={selected}
          loading={events.isLoading}
          onChange={(_event, value) => setEventId(value?.id ?? '')}
          getOptionLabel={(option) => option.title}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderOption={(props, option) => {
            const { key, ...rest } = props;
            return (
              <li key={key} {...rest}>
                <Box>
                  <Typography variant="body2">{option.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.publisherName}
                    {' · '}
                    {new Date(option.startsAt).toLocaleString()}
                  </Typography>
                </Box>
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField {...params} label={t('eventPicker')} required fullWidth />
          )}
        />
        <FormControl>
          <FormLabel id="event-push-audience-label">{t('audienceRule')}</FormLabel>
          <RadioGroup
            aria-labelledby="event-push-audience-label"
            value={audience}
            onChange={(e) => setAudience(e.target.value as 'area' | 'area_and_tag')}
          >
            <FormControlLabel value="area" control={<Radio />} label={t('audienceArea')} />
            <FormControlLabel
              value="area_and_tag"
              control={<Radio />}
              label={t('audienceAreaAndTag')}
            />
          </RadioGroup>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t('eventAudienceLead')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {audience === 'area' ? t('eventAudienceArea') : t('eventAudienceAreaAndTag')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('eventHint')}
          </Typography>
        </FormControl>
        <TextField
          label={t('titleSv')}
          value={titleSv}
          onChange={(e) => setTitleSv(e.target.value)}
          fullWidth
          required
        />
        <TextField
          label={t('bodySv')}
          value={bodySv}
          onChange={(e) => setBodySv(e.target.value)}
          fullWidth
          required
          multiline
          minRows={2}
        />
        <TextField
          label={t('titleEn')}
          value={titleEn}
          onChange={(e) => setTitleEn(e.target.value)}
          fullWidth
          required
        />
        <TextField
          label={t('bodyEn')}
          value={bodyEn}
          onChange={(e) => setBodyEn(e.target.value)}
          fullWidth
          required
          multiline
          minRows={2}
        />
        <TextField
          label={t('sendAt')}
          type="datetime-local"
          value={sendAt}
          onChange={(e) => setSendAt(e.target.value)}
          fullWidth
          helperText={t('eventSendAtHint')}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={() => create.mutate()} disabled={!canSubmit}>
            {t('eventCreate')}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
