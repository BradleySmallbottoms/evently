'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
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
  status: 'pending_scan' | 'in_review' | 'published';
  origin: string;
  createdAt: string;
};

function statusLabel(
  t: (key: 'statusPendingScan' | 'statusInReview' | 'statusPublished') => string,
  status: PublisherRow['status'],
): string {
  if (status === 'pending_scan') return t('statusPendingScan');
  if (status === 'in_review') return t('statusInReview');
  return t('statusPublished');
}

export function PublisherCatalog() {
  const t = useTranslations('PublisherCatalog');
  const tApp = useTranslations('App');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin-publishers-all'],
    queryFn: () => adminFetch<{ items: PublisherRow[] }>('/publishers?all=true'),
    retry: false,
  });

  const verify = useMutation({
    mutationFn: (id: string) => adminFetch(`/publishers/${id}/verify`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
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
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
    },
  });

  const items = [...(list.data?.items ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, locale, { sensitivity: 'base' }),
  );
  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id));
  const canVerify = items.some((item) => selected.has(item.id) && item.status !== 'published');
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

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography variant="h5" component="h2">
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
              disabled={!canVerify || busy}
              onClick={() => {
                setNotice(null);
                setBulkError(false);
                bulkVerify.mutate(
                  items
                    .filter((item) => selected.has(item.id) && item.status !== 'published')
                    .map((item) => item.id),
                );
              }}
            >
              {t('verify')}
            </Button>
          </Stack>
        ) : null}
      </Stack>
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {bulkError ? <Alert severity="error">{t('bulkError')}</Alert> : null}
      {list.isLoading ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {!list.isLoading && items.length === 0 ? (
        <Typography color="text.secondary">{t('empty')}</Typography>
      ) : null}
      {items.length > 0 ? (
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
              <TableCell>{t('origin')}</TableCell>
              <TableCell>{t('status')}</TableCell>
              <TableCell align="right">{t('actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} hover selected={selected.has(item.id)}>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={selected.has(item.id)}
                    onChange={() => toggleOne(item.id)}
                    slotProps={{ input: { 'aria-label': t('selectRow', { name: item.name }) } }}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`/publishers/${item.id}`}>{item.name}</Link>
                </TableCell>
                <TableCell>{item.slug}</TableCell>
                <TableCell>{item.origin}</TableCell>
                <TableCell>{statusLabel(t, item.status)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button component={Link} href={`/publishers/${item.id}`} size="small">
                      {t('edit')}
                    </Button>
                    {item.status !== 'published' ? (
                      <Button size="small" disabled={busy} onClick={() => verify.mutate(item.id)}>
                        {t('verify')}
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
