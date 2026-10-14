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

type ReviewItem = {
  id: string;
  publisherId: string;
  publisherName: string;
  title: string;
  startsAt: string;
  venueName: string | null;
  sourceUrl: string | null;
};

export function ReviewQueue({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('Events');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['admin-events-in-review'],
    queryFn: () => adminFetch<{ items: ReviewItem[] }>('/events?status=in_review'),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'reject' }) =>
      adminFetch(`/events/${input.id}/${input.action}`, { method: 'POST' }),
    onSuccess: async () => {
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
      <Typography variant={embedded ? 'h5' : 'h4'} component={embedded ? 'h2' : 'h1'}>
        {t('reviewTitle')}
      </Typography>
      {list.isLoading ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {!list.isLoading && items.length === 0 ? (
        <Typography color="text.secondary">{t('reviewEmpty')}</Typography>
      ) : null}
      {items.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('title')}</TableCell>
              <TableCell>{t('publisher')}</TableCell>
              <TableCell>{t('starts')}</TableCell>
              <TableCell>{t('venue')}</TableCell>
              <TableCell align="right">{t('actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  {item.sourceUrl ? (
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </TableCell>
                <TableCell>
                  <Link href={`/publishers/${item.publisherId}`}>{item.publisherName}</Link>
                </TableCell>
                <TableCell>{new Date(item.startsAt).toLocaleString()}</TableCell>
                <TableCell>{item.venueName ?? '—'}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button component={Link} href={`/events/${item.id}`} size="small">
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
