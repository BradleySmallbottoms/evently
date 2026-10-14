'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

type EventRow = {
  id: string;
  publisherId: string;
  publisherName: string;
  title: string;
  mode: string;
  status: string;
  origin: string;
  featured: boolean;
  checkInEnabled: boolean;
  startsAt: string;
  venueName: string | null;
};

const STATUSES = [
  'draft',
  'awaiting_verification',
  'in_review',
  'published',
  'cancelled',
  'ended',
] as const;

export function EventCatalog() {
  const t = useTranslations('EventCatalog');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

  const list = useQuery({
    queryKey: ['admin-events-catalog', statusFilter],
    queryFn: () =>
      adminFetch<{ items: EventRow[] }>(
        statusFilter ? `/events?status=${statusFilter}` : '/events',
      ),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'reject' | 'cancel' }) => {
      if (input.action === 'approve') {
        return adminFetch(`/events/${input.id}/approve`, { method: 'POST' });
      }
      if (input.action === 'reject') {
        return adminFetch(`/events/${input.id}/reject`, { method: 'POST' });
      }
      return adminFetch(`/events/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
  });

  if (list.isError) {
    const unauthorized = list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert severity={unauthorized ? 'info' : 'error'}>
        {unauthorized ? (
          <>
            {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
          </>
        ) : (
          t('loadError')
        )}
      </Alert>
    );
  }

  const items = list.data?.items ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        {t('title')}
      </Typography>
      <TextField
        select
        size="small"
        label={t('statusFilter')}
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        sx={{ maxWidth: 240 }}
      >
        <MenuItem value="">{t('allStatuses')}</MenuItem>
        {STATUSES.map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
      </TextField>
      {list.isLoading ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {!list.isLoading && items.length === 0 ? (
        <Typography color="text.secondary">{t('empty')}</Typography>
      ) : null}
      {items.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('titleCol')}</TableCell>
              <TableCell>{t('publisher')}</TableCell>
              <TableCell>{t('status')}</TableCell>
              <TableCell>{t('featured')}</TableCell>
              <TableCell>{t('checkIn')}</TableCell>
              <TableCell>{t('starts')}</TableCell>
              <TableCell align="right">{t('actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Link href={`/events/${item.id}`}>{item.title}</Link>
                </TableCell>
                <TableCell>
                  <Link href={`/publishers/${item.publisherId}`}>{item.publisherName}</Link>
                </TableCell>
                <TableCell>{item.status}</TableCell>
                <TableCell>{item.featured ? t('featuredYes') : t('featuredNo')}</TableCell>
                <TableCell>{item.checkInEnabled ? t('featuredYes') : t('featuredNo')}</TableCell>
                <TableCell>{new Date(item.startsAt).toLocaleString()}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    {item.status === 'in_review' ? (
                      <Button
                        size="small"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: item.id, action: 'approve' })}
                      >
                        {t('publish')}
                      </Button>
                    ) : null}
                    {item.status !== 'cancelled' ? (
                      <Button
                        size="small"
                        color="warning"
                        disabled={decide.isPending}
                        onClick={() =>
                          decide.mutate({
                            id: item.id,
                            action: item.status === 'in_review' ? 'reject' : 'cancel',
                          })
                        }
                      >
                        {t('cancel')}
                      </Button>
                    ) : null}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </Stack>
  );
}
