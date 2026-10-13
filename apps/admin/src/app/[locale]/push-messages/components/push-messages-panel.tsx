'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

const styles: Record<string, SxProps<Theme>> = {
  root: { display: 'flex', flexDirection: 'column', gap: 2 },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 2,
  },
};

type PushMessage = {
  id: string;
  eventId: string | null;
  eventTitle: string | null;
  publisherName: string | null;
  kind: string;
  audience: string;
  audienceTagName?: string | null;
  status: string;
  sendAt: string | null;
  createdAt: string;
};

export function PushMessagesPanel() {
  const t = useTranslations('PushMessages');
  const list = useQuery({
    queryKey: ['admin-push-messages'],
    queryFn: () => adminFetch<{ items: PushMessage[] }>('/push-messages'),
  });

  function audienceLabel(row: PushMessage): string {
    if (row.audience === 'area') return t('audienceArea');
    if (row.audience === 'area_and_tag') return t('audienceAreaAndTag');
    if (row.kind === 'broadcast') {
      if (row.audience === 'tag_interest') {
        return t('audienceTagLabel', { tag: row.audienceTagName ?? '—' });
      }
      return t('audienceEveryone');
    }
    return t('audienceEventMatch');
  }

  return (
    <Box sx={styles.root}>
      <Box sx={styles.header}>
        <Box>
          <Typography variant="h5">{t('title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('hint')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button component={Link} href="/push-messages/event" variant="outlined">
            {t('composeEvent')}
          </Button>
          <Button component={Link} href="/push-messages/broadcast" variant="contained">
            {t('composeBroadcast')}
          </Button>
        </Stack>
      </Box>
      {list.isError ? <Alert severity="error">{t('loadError')}</Alert> : null}
      {list.isLoading ? <Typography color="text.secondary">{t('loading')}</Typography> : null}
      {list.data?.items.length === 0 ? (
        <Alert severity="info">{t('empty')}</Alert>
      ) : null}
      {(list.data?.items.length ?? 0) > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('colKind')}</TableCell>
              <TableCell>{t('colTarget')}</TableCell>
              <TableCell>{t('colAudience')}</TableCell>
              <TableCell>{t('colStatus')}</TableCell>
              <TableCell>{t('colSendAt')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {list.data?.items.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>
                  <Chip
                    size="small"
                    label={row.kind === 'broadcast' ? t('kindBroadcast') : t('kindEvent')}
                  />
                </TableCell>
                <TableCell>
                  {row.kind === 'broadcast'
                    ? t('broadcastTarget')
                    : (row.eventTitle ?? '—')}
                  {row.publisherName ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {row.publisherName}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>{audienceLabel(row)}</TableCell>
                <TableCell>
                  <Chip size="small" label={row.status} />
                </TableCell>
                <TableCell>
                  {row.sendAt ? new Date(row.sendAt).toLocaleString() : t('asap')}
                </TableCell>
                <TableCell align="right">
                  <Button component={Link} href={`/push-messages/${row.id}`} size="small">
                    {t('edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button onClick={() => void list.refetch()} disabled={list.isFetching}>
          {t('refresh')}
        </Button>
      </Stack>
    </Box>
  );
}
