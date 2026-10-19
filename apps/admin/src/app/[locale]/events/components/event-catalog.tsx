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
import { ContentVerdictChip, type ContentVerdict } from '@/components/content-verdict';
import { EventTagCount, EventWarningMark, type EventWarning } from '@/components/event-warning';
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
  contentVerdict: ContentVerdict;
  tagCount: number;
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

type BulkAction = 'approve' | 'cancel' | 'delete' | 'wipe';

const PAGE_SIZE = 50;

export function EventCatalog() {
  const t = useTranslations('EventCatalog');
  const tVerdict = useTranslations('ContentVerdict');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowDeleteId, setRowDeleteId] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [rowWipeId, setRowWipeId] = useState<string | null>(null);
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
    mutationFn: (id: string) => adminFetch(`/events/${id}/approve`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
  });

  const removeOne = useMutation({
    mutationFn: (id: string) => adminFetch(`/events/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setRowDeleteId(null);
      setBulkError(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
    onError: () => {
      setRowDeleteId(null);
      setBulkError(true);
    },
  });

  const wipeOne = useMutation({
    mutationFn: (id: string) => adminFetch(`/events/${id}/wipe`, { method: 'POST' }),
    onSuccess: async () => {
      setRowWipeId(null);
      setBulkError(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
    onError: () => {
      setRowWipeId(null);
      setBulkError(true);
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
          if (input.action === 'wipe') {
            return adminFetch(`/events/${row.id}/wipe`, { method: 'POST' });
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
      setConfirmWipe(false);
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
  const busy = decide.isPending || bulk.isPending || removeOne.isPending || wipeOne.isPending;
  const reviewCount = selectedItems.filter(
    (item) => item.status === 'in_review' && item.origin === 'imported',
  ).length;
  const deleteCount = rowDeleteId ? 1 : reviewCount;
  const wipeCount = rowWipeId ? 1 : reviewCount;

  function closeDelete() {
    setConfirmDelete(false);
    setRowDeleteId(null);
  }

  function closeWipe() {
    setConfirmWipe(false);
    setRowWipeId(null);
  }
  const canPublish = selectedItems.some((item) => item.status === 'in_review');
  const canRemove = reviewCount > 0;
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
        : action === 'delete' || action === 'wipe'
          ? selectedItems.filter(
              (item) => item.status === 'in_review' && item.origin === 'imported',
            )
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
              disabled={!canRemove || busy}
              onClick={() => setConfirmDelete(true)}
            >
              {t('delete')}
            </Button>
            <Button
              size="small"
              color="error"
              variant="outlined"
              disabled={!canRemove || busy}
              onClick={() => setConfirmWipe(true)}
            >
              {t('wipe')}
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
              <TableCell>{t('tags')}</TableCell>
              <TableCell>{t('publisher')}</TableCell>
              <TableCell>{t('status')}</TableCell>
              <TableCell>{tVerdict('label')}</TableCell>
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
                  <EventTagCount count={item.tagCount} />
                </TableCell>
                <TableCell>
                  <Link href={`/publishers/${item.publisherId}`}>{item.publisherName}</Link>
                </TableCell>
                <TableCell>{item.status}</TableCell>
                <TableCell>
                  <ContentVerdictChip verdict={item.contentVerdict} />
                </TableCell>
                <TableCell>{item.featured ? t('featuredYes') : t('featuredNo')}</TableCell>
                <TableCell>{item.checkInEnabled ? t('featuredYes') : t('featuredNo')}</TableCell>
                <TableCell>{new Date(item.startsAt).toLocaleString()}</TableCell>
                <TableCell>{item.venueName}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    {item.status === 'in_review' ? (
                      <Button size="small" disabled={busy} onClick={() => decide.mutate(item.id)}>
                        {t('publish')}
                      </Button>
                    ) : null}
                    {item.status === 'in_review' && item.origin === 'imported' ? (
                      <Button
                        size="small"
                        color="error"
                        disabled={busy}
                        onClick={() => setRowDeleteId(item.id)}
                      >
                        {t('delete')}
                      </Button>
                    ) : null}
                    {item.status === 'in_review' && item.origin === 'imported' ? (
                      <Button
                        size="small"
                        color="error"
                        disabled={busy}
                        onClick={() => setRowWipeId(item.id)}
                      >
                        {t('wipe')}
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
      <Dialog open={confirmDelete || rowDeleteId !== null} onClose={closeDelete}>
        <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('deleteConfirmBody', { count: deleteCount })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDelete}>{t('cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={rowDeleteId ? busy : !canRemove || busy}
            onClick={() => {
              if (rowDeleteId) removeOne.mutate(rowDeleteId);
              else runBulk('delete');
            }}
          >
            {t('delete')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirmWipe || rowWipeId !== null} onClose={closeWipe}>
        <DialogTitle>{t('wipeConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('wipeConfirmBody', { count: wipeCount })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeWipe}>{t('cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={rowWipeId ? busy : !canRemove || busy}
            onClick={() => {
              if (rowWipeId) wipeOne.mutate(rowWipeId);
              else runBulk('wipe');
            }}
          >
            {t('wipe')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
