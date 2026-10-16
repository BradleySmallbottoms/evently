'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
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

type ReviewItem = {
  id: string;
  publisherId: string;
  publisherName: string;
  title: string;
  startsAt: string;
  venueName: string | null;
  sourceUrl: string | null;
  origin: 'native' | 'imported';
  warnings: EventWarning[];
};

type ReviewPage = {
  items: ReviewItem[];
  total: number;
  nextOffset: number | null;
};

type BulkAction = 'approve' | 'reject' | 'delete' | 'wipe';

const PAGE_SIZE = 100;

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return value;
  } catch {
    return null;
  }
  return null;
}

export function ReviewQueue({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('Events');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
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
    queryKey: ['admin-events-in-review', q, page],
    queryFn: () => {
      const params = new URLSearchParams({
        status: 'in_review',
        sort: 'created',
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (q) params.set('q', q);
      return adminFetch<ReviewPage>(`/events?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
    retry: false,
  });

  useEffect(() => {
    if (!list.data) return;
    const lastPage = Math.max(0, Math.ceil(list.data.total / PAGE_SIZE) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [list.data, page]);

  const decide = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'reject' }) =>
      adminFetch(`/events/${input.id}/${input.action}`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
  });

  const bulk = useMutation({
    mutationFn: async (input: { action: BulkAction; ids: string[] }) => {
      const results = await Promise.allSettled(
        input.ids.map((id) => {
          if (input.action === 'delete') {
            return adminFetch(`/events/${id}`, { method: 'DELETE' });
          }
          if (input.action === 'wipe') {
            return adminFetch(`/events/${id}/wipe`, { method: 'POST' });
          }
          return adminFetch(`/events/${id}/${input.action}`, { method: 'POST' });
        }),
      );
      const failedIds = input.ids.filter((_, index) => results[index]?.status === 'rejected');
      return { failedIds };
    },
    onSuccess: async ({ failedIds }) => {
      setConfirmDelete(false);
      setConfirmWipe(false);
      setSelected(new Set(failedIds));
      setBulkError(failedIds.length > 0);
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
  const waitingForPage = list.isLoading || (total > 0 && items.length === 0);
  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id));
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const busy = decide.isPending || bulk.isPending;

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

  const importedIds = selectedIds.filter(
    (id) => items.find((item) => item.id === id)?.origin === 'imported',
  );

  function runBulk(action: BulkAction) {
    const ids = action === 'wipe' || action === 'delete' ? importedIds : selectedIds;
    if (ids.length === 0) return;
    setBulkError(false);
    bulk.mutate({ action, ids });
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography variant={embedded ? 'h5' : 'h4'} component={embedded ? 'h2' : 'h1'}>
          {t('reviewTitle')}
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
              disabled={importedIds.length === 0 || busy}
              onClick={() => setConfirmDelete(true)}
            >
              {t('delete')}
            </Button>
            <Button
              size="small"
              color="error"
              variant="outlined"
              disabled={importedIds.length === 0 || busy}
              onClick={() => setConfirmWipe(true)}
            >
              {t('wipe')}
            </Button>
            <Button
              size="small"
              disabled={selectedIds.length === 0 || busy}
              onClick={() => runBulk('reject')}
            >
              {t('reject')}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={selectedIds.length === 0 || busy}
              onClick={() => runBulk('approve')}
            >
              {t('approve')}
            </Button>
          </Stack>
        ) : null}
      </Stack>
      {bulkError ? <Alert severity="error">{t('bulkError')}</Alert> : null}
      <TextField
        size="small"
        label={t('search')}
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        sx={{ maxWidth: { sm: 420 } }}
      />
      {waitingForPage ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {!waitingForPage && items.length === 0 ? (
        <Typography color="text.secondary">{q ? t('reviewNoMatch') : t('reviewEmpty')}</Typography>
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
              <TableCell>{t('title')}</TableCell>
              <TableCell>{t('publisher')}</TableCell>
              <TableCell>{t('starts')}</TableCell>
              <TableCell>{t('venue')}</TableCell>
              <TableCell align="right">{t('actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => {
              const source = httpUrl(item.sourceUrl);
              return (
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
                  <TableCell>{new Date(item.startsAt).toLocaleString()}</TableCell>
                  <TableCell>{item.venueName ?? '—'}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      {source ? (
                        <Button
                          component="a"
                          href={source}
                          target="_blank"
                          rel="noopener noreferrer"
                          size="small"
                        >
                          {t('view')}
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        variant="contained"
                        disabled={busy}
                        onClick={() => decide.mutate({ id: item.id, action: 'approve' })}
                      >
                        {t('approve')}
                      </Button>
                      <Button
                        size="small"
                        color="inherit"
                        disabled={busy}
                        onClick={() => decide.mutate({ id: item.id, action: 'reject' })}
                      >
                        {t('reject')}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
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
            {t('deleteConfirmBody', { count: importedIds.length })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t('cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy || importedIds.length === 0}
            onClick={() => runBulk('delete')}
          >
            {t('delete')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirmWipe} onClose={() => setConfirmWipe(false)}>
        <DialogTitle>{t('wipeConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('wipeConfirmBody', { count: importedIds.length })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmWipe(false)}>{t('cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy || importedIds.length === 0}
            onClick={() => runBulk('wipe')}
          >
            {t('wipe')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
