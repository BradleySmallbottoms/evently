'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { EventWarningMark, type EventWarning } from '@/components/event-warning';
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
  warnings: EventWarning[];
};

const STATUSES = [
  'draft',
  'awaiting_verification',
  'in_review',
  'published',
  'cancelled',
  'ended',
] as const;

type BulkAction = 'approve' | 'cancel' | 'delete';

const PAGE_SIZE = 50;

export function EventCatalog() {
  const t = useTranslations('EventCatalog');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkError, setBulkError] = useState(false);
  const appliedSearch = useRef('');

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = searchInput.trim();
      if (appliedSearch.current === next) return;
      appliedSearch.current = next;
      setQ(next);
      setPage(0);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const list = useQuery({
    queryKey: ['admin-events-catalog', statusFilter, q, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (q) params.set('q', q);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      return adminFetch<{ items: EventRow[]; total: number; nextOffset: number | null }>(
        `/events?${params.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
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

  const bulk = useMutation({
    mutationFn: async (input: { action: BulkAction; rows: { id: string; status: string }[] }) => {
      const results = await Promise.allSettled(
        input.rows.map((row) => {
          if (input.action === 'approve') {
            return adminFetch(`/events/${row.id}/approve`, { method: 'POST' });
          }
          if (input.action === 'delete') {
            return adminFetch(`/events/${row.id}`, { method: 'DELETE' });
          }
          if (row.status === 'in_review') {
            return adminFetch(`/events/${row.id}/reject`, { method: 'POST' });
          }
          return adminFetch(`/events/${row.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled' }),
          });
        }),
      );
      const failedIds = input.rows
        .filter((_, index) => results[index]?.status === 'rejected')
        .map((row) => row.id);
      return { failedIds };
    },
    onSuccess: async ({ failedIds }) => {
      setConfirmDelete(false);
      setSelected(new Set(failedIds));
      setBulkError(failedIds.length > 0);
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
  const total = list.data?.total ?? 0;
  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id));
  const selectedItems = items.filter((item) => selected.has(item.id));
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const busy = decide.isPending || bulk.isPending;
  const canPublish = selectedItems.some((item) => item.status === 'in_review');
  const canCancel = selectedItems.some((item) => item.status !== 'cancelled');

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

  function runBulk(action: BulkAction) {
    const rows =
      action === 'cancel'
        ? selectedItems.filter((item) => item.status !== 'cancelled')
        : selectedItems.filter((item) => item.status === 'in_review');
    if (rows.length === 0) return;
    setBulkError(false);
    bulk.mutate({
      action,
      rows: rows.map((item) => ({ id: item.id, status: item.status })),
    });
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography variant="h4" component="h1">
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
              color="error"
              variant="outlined"
              disabled={!canPublish || busy}
              onClick={() => setConfirmDelete(true)}
            >
              {t('delete')}
            </Button>
            <Button size="small" disabled={!canCancel || busy} onClick={() => runBulk('cancel')}>
              {t('cancel')}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={!canPublish || busy}
              onClick={() => runBulk('approve')}
            >
              {t('publish')}
            </Button>
          </Stack>
        ) : null}
      </Stack>
      {bulkError ? <Alert severity="error">{t('bulkError')}</Alert> : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          size="small"
          label={t('search')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          sx={{ flex: 1, maxWidth: { sm: 420 } }}
        />
        <TextField
          select
          size="small"
          label={t('statusFilter')}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
            setSelected(new Set());
          }}
          sx={{ minWidth: 180, maxWidth: 240 }}
        >
          <MenuItem value="">{t('allStatuses')}</MenuItem>
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
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
              <TableCell>{t('titleCol')}</TableCell>
              <TableCell>{t('publisher')}</TableCell>
              <TableCell>{t('status')}</TableCell>
              <TableCell>{t('featured')}</TableCell>
              <TableCell>{t('checkIn')}</TableCell>
              <TableCell>{t('starts')}</TableCell>
              <TableCell>{t('venue')}</TableCell>
              <TableCell align="right">{t('actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} selected={selected.has(item.id)}>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={selected.has(item.id)}
                    onChange={() => toggleOne(item.id)}
                    slotProps={{ input: { 'aria-label': t('selectRow', { title: item.title }) } }}
                  />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <EventWarningMark warnings={item.warnings} />
                    <Link href={`/events/${item.id}`}>{item.title}</Link>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Link href={`/publishers/${item.publisherId}`}>{item.publisherName}</Link>
                </TableCell>
                <TableCell>{item.status}</TableCell>
                <TableCell>{item.featured ? t('featuredYes') : t('featuredNo')}</TableCell>
                <TableCell>{item.checkInEnabled ? t('featuredYes') : t('featuredNo')}</TableCell>
                <TableCell>{new Date(item.startsAt).toLocaleString()}</TableCell>
                <TableCell>{item.venueName}</TableCell>
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
      {total > 0 ? (
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, next) => {
            setSelected(new Set());
            setPage(next);
          }}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[]}
          labelDisplayedRows={({ from, to, count }) => t('pageRange', { from, to, count })}
          getItemAriaLabel={(type) =>
            type === 'next'
              ? t('pageNext')
              : type === 'previous'
                ? t('pagePrev')
                : type === 'first'
                  ? t('pageFirst')
                  : t('pageLast')
          }
        />
      ) : null}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('deleteConfirmBody', {
              count: selectedItems.filter((item) => item.status === 'in_review').length,
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t('cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!canPublish || busy}
            onClick={() => runBulk('delete')}
          >
            {t('delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
