'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

type PublisherRow = {
  id: string;
  name: string;
  slug: string;
  type: string;
  origin: string;
  createdAt: string;
};

export function VerificationQueue() {
  const t = useTranslations('Publishers');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ['admin-me'],
    queryFn: () => adminFetch<{ email: string }>('/admin/me'),
    retry: false,
  });

  const list = useQuery({
    queryKey: ['admin-publishers-unverified'],
    queryFn: async () => {
      const body = await adminFetch<{ items: PublisherRow[] }>('/publishers?verified=false');
      return body.items;
    },
    enabled: Boolean(me.data),
    retry: false,
  });

  const verify = useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ releasedEventCount: number }>(`/publishers/${id}/verify`, {
        method: 'POST',
      }),
    onSuccess: async (result) => {
      setNotice(t('verifiedNotice', { count: result.releasedEventCount }));
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
    },
  });

  if (me.isPending) {
    return (
      <Typography color="text.secondary">{tApp('loading')}</Typography>
    );
  }

  if (me.isError || !me.data) {
    return (
      <Stack spacing={2}>
        <Typography variant="h4" component="h1">
          {t('title')}
        </Typography>
        <Alert severity="info">
          {t('needLogin')}{' '}
          <Link href="/login">{tApp('navLogin')}</Link>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        {t('title')}
      </Typography>
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {list.isError ? (
        <Alert severity="error">
          {list.error instanceof AdminApiError ? list.error.message : t('loadError')}
        </Alert>
      ) : null}
      {list.isPending ? (
        <Typography color="text.secondary">{tApp('loading')}</Typography>
      ) : list.data && list.data.length === 0 ? (
        <Typography color="text.secondary">{t('empty')}</Typography>
      ) : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('name')}</TableCell>
                <TableCell>{t('slug')}</TableCell>
                <TableCell>{t('type')}</TableCell>
                <TableCell>{t('origin')}</TableCell>
                <TableCell>{t('created')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(list.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.slug}</TableCell>
                  <TableCell>{row.type}</TableCell>
                  <TableCell>{row.origin}</TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="contained"
                      disabled={verify.isPending}
                      onClick={() => {
                        setNotice(null);
                        verify.mutate(row.id);
                      }}
                    >
                      {verify.isPending ? t('verifying') : t('verify')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
