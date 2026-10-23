'use client';

import { canRescanImportedEvent } from '@local-events/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarIcon, MoreHorizontalIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ContentVerdictChip, type ContentVerdict } from '@/components/content-verdict';
import { EventTagCount, EventWarningMark, type EventWarning } from '@/components/event-warning';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

type EventRow = {
  id: string;
  publisherId: string | null;
  publisherName: string;
  title: string;
  mode: string;
  status: string;
  origin: string;
  featured: boolean;
  checkInEnabled: boolean;
  startsAt: string | null;
  venueName: string | null;
  contentVerdict: ContentVerdict;
  tagCount: number;
  warnings: EventWarning[];
};

const STATUSES = [
  'draft',
  'awaiting_verification',
  'pending_scan',
  'in_review',
  'published',
  'cancelled',
  'ended',
] as const;

const ALL_STATUSES = 'all';
const ALL_TAGS = 'all';
const NO_TAGS = 'none';

type BulkAction = 'approve' | 'remove' | 'rescan';

const PAGE_SIZE = 50;

export function EventCatalog() {
  const t = useTranslations('EventCatalog');
  const tVerdict = useTranslations('ContentVerdict');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowDeleteId, setRowDeleteId] = useState<string | null>(null);
  const [permanent, setPermanent] = useState(false);
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
    queryKey: ['admin-events-catalog', statusFilter, tagFilter, q, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (tagFilter === NO_TAGS) params.set('untagged', 'true');
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

  const bulk = useMutation({
    mutationFn: async (input: {
      action: BulkAction;
      permanent?: boolean;
      rows: { id: string; status: string }[];
    }) => {
      const results = await Promise.allSettled(
        input.rows.map((row) => {
          if (input.action === 'approve') {
            return adminFetch(`/events/${row.id}/approve`, { method: 'POST' });
          }
          if (input.action === 'rescan') {
            return adminFetch(`/events/${row.id}/rescan`, { method: 'POST' });
          }
          if (input.permanent) {
            return adminFetch(`/events/${row.id}/wipe`, { method: 'POST' });
          }
          return adminFetch(`/events/${row.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'deleted' }),
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
      setRowDeleteId(null);
      setPermanent(false);
      setSelected(new Set(failedIds));
      setBulkError(failedIds.length > 0);
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
  });

  if (list.isError) {
    const unauthorized = list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert variant={unauthorized ? 'default' : 'destructive'}>
        <AlertDescription>
          {unauthorized ? (
            <>
              {t('needLogin')}{' '}
              <Link href="/login" className="underline underline-offset-4">
                {tApp('navLogin')}
              </Link>
            </>
          ) : (
            t('loadError')
          )}
        </AlertDescription>
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
  const deleteTargets = rowDeleteId
    ? items.filter((item) => item.id === rowDeleteId)
    : selectedItems;
  const deleteCount = deleteTargets.length;

  function closeDelete() {
    setConfirmDelete(false);
    setRowDeleteId(null);
    setPermanent(false);
  }

  function openDelete(id?: string) {
    setPermanent(false);
    setRowDeleteId(id ?? null);
    setConfirmDelete(id == null);
  }

  const canPublish = selectedItems.some((item) => item.status === 'in_review');
  const canRescan = selectedItems.some(canRescanImportedEvent);

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
      action === 'remove'
        ? deleteTargets
        : action === 'rescan'
          ? selectedItems.filter(canRescanImportedEvent)
          : selectedItems.filter((item) => item.status === 'in_review');
    if (rows.length === 0) return;
    setBulkError(false);
    bulk.mutate({
      action,
      permanent: action === 'remove' ? permanent : undefined,
      rows: rows.map((item) => ({ id: item.id, status: item.status })),
    });
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusItems = {
    [ALL_STATUSES]: t('allStatuses'),
    ...Object.fromEntries(STATUSES.map((status) => [status, status])),
  };
  const tagItems = {
    [ALL_TAGS]: t('allTags'),
    [NO_TAGS]: t('noTags'),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {items.length > 0 ? (
          <div className="flex flex-row flex-wrap items-center gap-2">
            {selectedIds.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('selected', { count: selectedIds.length })}
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={selectedIds.length === 0 || busy}
              onClick={() => openDelete()}
            >
              {t('delete')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canRescan || busy}
              onClick={() => runBulk('rescan')}
            >
              {t('rescan')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canPublish || busy}
              onClick={() => runBulk('approve')}
            >
              {t('publish')}
            </Button>
          </div>
        ) : null}
      </div>
      {bulkError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('bulkError')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Field className="flex-1 sm:max-w-[420px]">
          <FieldLabel htmlFor="event-catalog-search">{t('search')}</FieldLabel>
          <Input
            id="event-catalog-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </Field>
        <Field className="w-full min-w-[180px] max-w-60">
          <FieldLabel htmlFor="event-catalog-status">{t('statusFilter')}</FieldLabel>
          <Select
            items={statusItems}
            value={statusFilter === '' ? ALL_STATUSES : statusFilter}
            onValueChange={(next) => {
              if (next == null) return;
              setStatusFilter(next === ALL_STATUSES ? '' : next);
              setPage(0);
              setSelected(new Set());
            }}
          >
            <SelectTrigger id="event-catalog-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_STATUSES}>{t('allStatuses')}</SelectItem>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field className="w-full min-w-[180px] max-w-60">
          <FieldLabel htmlFor="event-catalog-tags">{t('tagsFilter')}</FieldLabel>
          <Select
            items={tagItems}
            value={tagFilter === '' ? ALL_TAGS : tagFilter}
            onValueChange={(next) => {
              if (next == null) return;
              setTagFilter(next === ALL_TAGS ? '' : next);
              setPage(0);
              setSelected(new Set());
            }}
          >
            <SelectTrigger id="event-catalog-tags" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_TAGS}>{t('allTags')}</SelectItem>
                <SelectItem value={NO_TAGS}>{t('noTags')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {list.isLoading ? <LoadingRows /> : null}
      {!list.isLoading && items.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title={q || statusFilter || tagFilter ? t('emptyMatch') : t('empty')}
        />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={() => toggleAll()}
                    aria-label={t('selectAll')}
                  />
                </TableHead>
                <TableHead>{t('titleCol')}</TableHead>
                <TableHead>{t('tags')}</TableHead>
                <TableHead>{t('publisher')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{tVerdict('label')}</TableHead>
                <TableHead>{t('featured')}</TableHead>
                <TableHead>{t('checkIn')}</TableHead>
                <TableHead>{t('starts')}</TableHead>
                <TableHead>{t('venue')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} data-state={selected.has(item.id) ? 'selected' : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={() => toggleOne(item.id)}
                      aria-label={t('selectRow', { title: item.title })}
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-row items-center gap-1.5">
                      <EventWarningMark warnings={item.warnings} />
                      <Link
                        href={`/events/${item.id}`}
                        className="whitespace-nowrap max-w-[400] overflow-hidden text-ellipsis underline underline-offset-4"
                      >
                        {item.title}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EventTagCount count={item.tagCount} />
                  </TableCell>
                  <TableCell>
                    {item.publisherId ? (
                      <Link
                        href={`/publishers/${item.publisherId}`}
                        className="underline underline-offset-4"
                      >
                        {item.publisherName}
                      </Link>
                    ) : (
                      item.publisherName
                    )}
                  </TableCell>
                  <TableCell>{item.status}</TableCell>
                  <TableCell>
                    <ContentVerdictChip verdict={item.contentVerdict} />
                  </TableCell>
                  <TableCell>{item.featured ? t('featuredYes') : t('featuredNo')}</TableCell>
                  <TableCell>{item.checkInEnabled ? t('featuredYes') : t('featuredNo')}</TableCell>
                  <TableCell>
                    {item.startsAt ? new Date(item.startsAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>{item.venueName}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="size-8" disabled={busy}>
                            <MoreHorizontalIcon />
                            <span className="sr-only">{t('openMenu')}</span>
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {item.status === 'in_review' ? (
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              disabled={busy}
                              onClick={() => decide.mutate(item.id)}
                            >
                              {t('publish')}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        ) : null}
                        {canRescanImportedEvent(item) ? (
                          <>
                            {item.status === 'in_review' ? <DropdownMenuSeparator /> : null}
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                disabled={busy}
                                onClick={() =>
                                  bulk.mutate({
                                    action: 'rescan',
                                    rows: [{ id: item.id, status: item.status }],
                                  })
                                }
                              >
                                {t('rescan')}
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </>
                        ) : null}
                        {item.status === 'in_review' || canRescanImportedEvent(item) ? (
                          <DropdownMenuSeparator />
                        ) : null}
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={busy}
                            onClick={() => openDelete(item.id)}
                          >
                            {t('delete')}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {total > 0 ? (
        <div className="flex items-center justify-end gap-2 px-2 py-2">
          <p className="text-sm text-muted-foreground">
            {t('pageRange', { from, to, count: total })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('pagePrev')}
            disabled={page === 0}
            onClick={() => {
              setSelected(new Set());
              setPage(page - 1);
            }}
          >
            {t('pagePrev')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('pageNext')}
            disabled={page >= pageCount - 1}
            onClick={() => {
              setSelected(new Set());
              setPage(page + 1);
            }}
          >
            {t('pageNext')}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={confirmDelete || rowDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTargets.length === 1 ? t('deleteConfirmTitleOne') : t('deleteConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {permanent
                ? t('deletePermanentBody', { count: deleteCount })
                : t('deleteConfirmBody', { count: deleteCount })}
            </DialogDescription>
          </DialogHeader>
          <Field orientation="horizontal">
            <Checkbox
              id="event-delete-permanent"
              checked={permanent}
              onCheckedChange={(checked) => setPermanent(checked === true)}
            />
            <FieldLabel htmlFor="event-delete-permanent">{t('deletePermanent')}</FieldLabel>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || deleteCount === 0}
              onClick={() => runBulk('remove')}
            >
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
