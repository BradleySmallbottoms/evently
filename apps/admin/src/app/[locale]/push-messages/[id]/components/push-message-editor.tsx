'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

const styles: Record<string, SxProps<Theme>> = {
  root: {
    display: 'grid',
    gap: 3,
    gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
    alignItems: 'start',
  },
  panel: { p: 2, display: 'flex', flexDirection: 'column', gap: 2 },
  stats: { p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 },
  statRow: { display: 'flex', justifyContent: 'space-between', gap: 2 },
};

type PushMessage = {
  id: string;
  eventId: string | null;
  eventTitle: string | null;
  publisherName: string | null;
  eventStatus: string | null;
  kind: string;
  audience: string;
  audienceTagName?: string | null;
  status: string;
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
  sendAt: string | null;
};

type Audience = {
  nearby: number;
  publisherFollowers: number;
  uniqueRecipients: number;
  withPushToken: number;
  capped: boolean;
  eventPublished: boolean;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PushMessageEditor({ pushMessageId }: { pushMessageId: string }) {
  const t = useTranslations('PushMessages');
  const id = pushMessageId;
  const queryClient = useQueryClient();
  const message = useQuery({
    queryKey: ['admin-push-message', id],
    queryFn: () => adminFetch<PushMessage>(`/push-messages/${id}`),
  });
  const audience = useQuery({
    queryKey: ['admin-push-audience', id],
    queryFn: () => adminFetch<Audience>(`/push-messages/${id}/audience`),
  });

  const [titleSv, setTitleSv] = useState('');
  const [bodySv, setBodySv] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [sendAt, setSendAt] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!message.data) return;
    setTitleSv(message.data.titleSv);
    setBodySv(message.data.bodySv);
    setTitleEn(message.data.titleEn);
    setBodyEn(message.data.bodyEn);
    setSendAt(toLocalInput(message.data.sendAt));
  }, [message.data]);

  const save = useMutation({
    mutationFn: () =>
      adminFetch<PushMessage>(`/push-messages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          titleSv,
          bodySv,
          titleEn,
          bodyEn,
          sendAt: sendAt ? new Date(sendAt).toISOString() : null,
        }),
      }),
    onSuccess: async () => {
      setNotice(t('saved'));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-message', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
    },
    onError: () => setError(t('saveError')),
  });

  const approve = useMutation({
    mutationFn: () =>
      adminFetch<PushMessage>(`/push-messages/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          sendAt: sendAt ? new Date(sendAt).toISOString() : null,
        }),
      }),
    onSuccess: async () => {
      setNotice(t('approved'));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-message', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-audience', id] });
    },
    onError: () => setError(t('approveError')),
  });

  const reject = useMutation({
    mutationFn: () =>
      adminFetch<PushMessage>(`/push-messages/${id}/reject`, { method: 'POST' }),
    onSuccess: async () => {
      setNotice(t('rejected'));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-message', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
    },
    onError: () => setError(t('rejectError')),
  });

  if (message.isLoading) {
    return <Typography color="text.secondary">{t('loading')}</Typography>;
  }
  if (message.isError || !message.data) {
    return <Alert severity="error">{t('loadError')}</Alert>;
  }

  const editable =
    message.data.status === 'pending' ||
    message.data.status === 'approved' ||
    message.data.status === 'rejected';

  return (
    <Box sx={styles.root}>
      <Paper sx={styles.panel} variant="outlined">
        <Button component={Link} href="/push-messages" size="small" sx={{ alignSelf: 'flex-start' }}>
          {t('back')}
        </Button>
        <Typography variant="h5">{t('editorTitle')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {message.data.kind === 'broadcast'
            ? `${t('kindBroadcast')} · ${
                message.data.audience === 'tag_interest'
                  ? t('audienceTagLabel', { tag: message.data.audienceTagName ?? '—' })
                  : t('audienceEveryone')
              } · ${message.data.status}`
            : `${message.data.eventTitle ?? '—'} · ${message.data.publisherName ?? '—'} · ${
                message.data.audience === 'area'
                  ? t('audienceArea')
                  : message.data.audience === 'area_and_tag'
                    ? t('audienceAreaAndTag')
                    : t('audienceEventMatch')
              } · ${message.data.status}`}
        </Typography>
        {notice ? <Alert severity="success">{notice}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          label={t('titleSv')}
          value={titleSv}
          onChange={(e) => setTitleSv(e.target.value)}
          disabled={!editable}
          fullWidth
        />
        <TextField
          label={t('bodySv')}
          value={bodySv}
          onChange={(e) => setBodySv(e.target.value)}
          disabled={!editable}
          fullWidth
          multiline
          minRows={2}
        />
        <TextField
          label={t('titleEn')}
          value={titleEn}
          onChange={(e) => setTitleEn(e.target.value)}
          disabled={!editable}
          fullWidth
        />
        <TextField
          label={t('bodyEn')}
          value={bodyEn}
          onChange={(e) => setBodyEn(e.target.value)}
          disabled={!editable}
          fullWidth
          multiline
          minRows={2}
        />
        <TextField
          label={t('sendAt')}
          type="datetime-local"
          value={sendAt}
          onChange={(e) => setSendAt(e.target.value)}
          disabled={!editable}
          fullWidth
          helperText={
            message.data.kind === 'broadcast' ? t('broadcastSendAtHint') : t('sendAtHint')
          }
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            onClick={() => save.mutate()}
            disabled={!editable || save.isPending}
          >
            {t('save')}
          </Button>
          {message.data.kind !== 'broadcast' ? (
            <Button
              variant="contained"
              color="success"
              onClick={() => approve.mutate()}
              disabled={!editable || approve.isPending}
            >
              {t('approve')}
            </Button>
          ) : null}
          <Button
            variant="outlined"
            color="warning"
            onClick={() => reject.mutate()}
            disabled={!editable || reject.isPending}
          >
            {message.data.kind === 'broadcast' ? t('cancelBroadcast') : t('reject')}
          </Button>
          {message.data.eventId ? (
            <Button component={Link} href={`/events/${message.data.eventId}`} size="small">
              {t('openEvent')}
            </Button>
          ) : null}
        </Stack>
      </Paper>

      <Paper sx={styles.stats} variant="outlined">
        <Typography variant="h6">{t('audienceTitle')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('audienceHint')}
        </Typography>
        {message.data.kind !== 'broadcast' && !audience.data?.eventPublished ? (
          <Alert severity="info">{t('notPublished')}</Alert>
        ) : null}
        {audience.isLoading ? (
          <Typography color="text.secondary">{t('loading')}</Typography>
        ) : audience.data ? (
          <>
            {message.data.kind === 'broadcast' ? null : (
              <>
                <Box sx={styles.statRow}>
                  <Typography>
                    {message.data.audience === 'area'
                      ? t('audienceArea')
                      : message.data.audience === 'area_and_tag'
                        ? t('audienceAreaAndTag')
                        : t('statNearby')}
                  </Typography>
                  <Typography sx={{ fontWeight: 600 }}>{audience.data.nearby}</Typography>
                </Box>
                <Box sx={styles.statRow}>
                  <Typography>{t('statFollowers')}</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {audience.data.publisherFollowers}
                  </Typography>
                </Box>
              </>
            )}
            <Box sx={styles.statRow}>
              <Typography>{t('statUnique')}</Typography>
              <Typography sx={{ fontWeight: 600 }}>{audience.data.uniqueRecipients}</Typography>
            </Box>
            <Box sx={styles.statRow}>
              <Typography>{t('statTokens')}</Typography>
              <Typography sx={{ fontWeight: 600 }}>{audience.data.withPushToken}</Typography>
            </Box>
            {audience.data.capped ? <Alert severity="warning">{t('capped')}</Alert> : null}
            <Typography variant="caption" color="text.secondary">
              {t('aggregateNote')}
            </Typography>
          </>
        ) : null}
        <Button size="small" onClick={() => void audience.refetch()}>
          {t('refreshAudience')}
        </Button>
      </Paper>
    </Box>
  );
}
