'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

type PendingPush = {
  id: string;
  eventId: string | null;
  eventTitle: string | null;
  publisherName: string | null;
  sendAt: string | null;
  titleSv: string;
  titleEn: string;
};

export function PendingNotifications() {
  const t = useTranslations('Review');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['admin-push-messages', 'pending'],
    queryFn: () => adminFetch<{ items: PendingPush[] }>('/push-messages?status=pending'),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'reject' }) =>
      adminFetch(`/push-messages/${input.id}/${input.action}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages', 'pending'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
    },
  });

  if (list.isError) {
    const unauthorized = list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert severity={unauthorized ? 'info' : 'error'}>
        {unauthorized ? t('needLogin') : t('notificationsError')}
      </Alert>
    );
  }

  const items = list.data?.items ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h2">
        {t('notificationsTitle')}
      </Typography>
      {list.isLoading ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {!list.isLoading && items.length === 0 ? (
        <Typography color="text.secondary">{t('notificationsEmpty')}</Typography>
      ) : null}
      {items.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('notification')}</TableCell>
              <TableCell>{t('event')}</TableCell>
              <TableCell>{t('publisher')}</TableCell>
              <TableCell>{t('sendAt')}</TableCell>
              <TableCell align="right">{t('actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.titleSv}</TableCell>
                <TableCell>
                  {item.eventId ? (
                    <Link href={`/events/${item.eventId}`}>{item.eventTitle ?? item.eventId}</Link>
                  ) : (
                    (item.eventTitle ?? '—')
                  )}
                </TableCell>
                <TableCell>{item.publisherName ?? '—'}</TableCell>
                <TableCell>
                  {item.sendAt ? new Date(item.sendAt).toLocaleString() : t('asap')}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button component={Link} href={`/push-messages/${item.id}`} size="small">
                      {t('view')}
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: item.id, action: 'approve' })}
                    >
                      {t('approve')}
                    </Button>
                    <Button
                      size="small"
                      color="inherit"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: item.id, action: 'reject' })}
                    >
                      {t('reject')}
                    </Button>
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
