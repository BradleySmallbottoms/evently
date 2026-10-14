'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
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

export function VerificationQueue({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('Publishers');
  const tApp = useTranslations('App');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState(false);

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
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
    },
  });

  const bulkVerify = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          adminFetch<{ releasedEventCount: number }>(`/publishers/${id}/verify`, {
            method: 'POST',
          }),
        ),
      );
      const failedIds = ids.filter((_, index) => results[index]?.status === 'rejected');
      const released = results.reduce(
        (sum, result) =>
          result.status === 'fulfilled' ? sum + result.value.releasedEventCount : sum,
        0,
      );
      return { failedIds, released };
    },
    onSuccess: async ({ failedIds, released }) => {
      setSelected(new Set(failedIds));
      setBulkError(failedIds.length > 0);
      setNotice(failedIds.length === 0 ? t('verifiedNotice', { count: released }) : null);
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
    },
  });

  if (me.isPending) {
    return <Typography color="text.secondary">{tApp('loading')}</Typography>;
  }

  if (me.isError || !me.data) {
    return (
      <Stack spacing={2}>
        <Typography variant={embedded ? 'h5' : 'h4'} component={embedded ? 'h2' : 'h1'}>
          {t('title')}
        </Typography>
        <Alert severity="info">
          {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
        </Alert>
      </Stack>
    );
  }

  const items = [...(list.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, locale, { sensitivity: 'base' }),
  );
  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id));
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const busy = verify.isPending || bulkVerify.isPending;

  function toggleAll() {
    setBulkError(false);
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  }

  function toggleOne(id: string) {
    setBulkError(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography variant={embedded ? 'h5' : 'h4'} component={embedded ? 'h2' : 'h1'}>
          {t('title')}
        </Typography>
        {items.length > 0 ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {selectedIds.length > 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('selected', { count: selectedIds.length })}
              </Typography>
            ) : null}
            <Button
              size="small"
              variant="contained"
              disabled={selectedIds.length === 0 || busy}
              onClick={() => {
                setNotice(null);
                setBulkError(false);
                bulkVerify.mutate(selectedIds);
              }}
            >
              {t('verify')}
            </Button>
          </Stack>
        ) : null}
      </Stack>
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {bulkError ? <Alert severity="error">{t('bulkError')}</Alert> : null}
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
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                    slotProps={{ input: { 'aria-label': t('selectAll') } }}
                  />
                </TableCell>
                <TableCell>{t('name')}</TableCell>
                <TableCell>{t('slug')}</TableCell>
                <TableCell>{t('type')}</TableCell>
                <TableCell>{t('origin')}</TableCell>
                <TableCell>{t('created')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id} selected={selected.has(row.id)}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                      slotProps={{ input: { 'aria-label': t('selectRow', { name: row.name }) } }}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/publishers/${row.id}`}>{row.name}</Link>
                  </TableCell>
                  <TableCell>{row.slug}</TableCell>
                  <TableCell>{row.type}</TableCell>
                  <TableCell>{row.origin}</TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      <Button component={Link} href={`/publishers/${row.id}`} size="small">
                        {t('edit')}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={busy}
                        onClick={() => {
                          setNotice(null);
                          verify.mutate(row.id);
                        }}
                      >
                        {busy ? t('verifying') : t('verify')}
                      </Button>
                    </Stack>
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
