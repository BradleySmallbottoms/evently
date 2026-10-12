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

type PublisherRow = {
  id: string;
  name: string;
  slug: string;
  type: string;
  verified: boolean;
  origin: string;
  createdAt: string;
};

export function PublisherCatalog() {
  const t = useTranslations('PublisherCatalog');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['admin-publishers-all'],
    queryFn: () => adminFetch<{ items: PublisherRow[] }>('/publishers?all=true'),
    retry: false,
  });

  const verify = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/publishers/${id}/verify`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers'] });
    },
  });

  if (list.isError) {
    const unauthorized =
      list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert severity={unauthorized ? 'info' : 'error'}>
        {unauthorized ? (
          <>
            {t('needLogin')}{' '}
            <Link href="/login">{tApp('navLogin')}</Link>
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
      <Typography variant="h5" component="h2">
        {t('title')}
      </Typography>
      {list.isLoading ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {!list.isLoading && items.length === 0 ? (
        <Typography color="text.secondary">{t('empty')}</Typography>
      ) : null}
      {items.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('name')}</TableCell>
              <TableCell>{t('slug')}</TableCell>
              <TableCell>{t('origin')}</TableCell>
              <TableCell>{t('verified')}</TableCell>
              <TableCell align="right">{t('actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.slug}</TableCell>
                <TableCell>{item.origin}</TableCell>
                <TableCell>{item.verified ? '✓' : '—'}</TableCell>
                <TableCell align="right">
                  {!item.verified ? (
                    <Button
                      size="small"
                      disabled={verify.isPending}
                      onClick={() => verify.mutate(item.id)}
                    >
                      {t('verify')}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </Stack>
  );
}
