'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarIcon, MoreHorizontalIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ContentVerdictChip, type ContentVerdict } from '@/components/content-verdict';
import { WorkerFilter } from '@/components/worker-filter';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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

type ReviewItem = {
  id: string;
  publisherId: string;
  publisherName: string;
  title: string;
  startsAt: string | null;
  venueName: string | null;
  sourceUrl: string | null;
  workerId: string | null;
  origin: 'native' | 'imported';
  contentVerdict: ContentVerdict;
  tagCount: number;
  warnings: EventWarning[];
};

type ReviewPage = {
  items: ReviewItem[];
  total: number;
  nextOffset: number | null;
};

type BulkAction = 'approve' | 'reject' | 'rescan' | 'delete' | 'wipe';

const PAGE_SIZE = 100;
const ALL_TAGS = 'all';
const NO_TAGS = 'none';

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
  const tVerdict = useTranslations('ContentVerdict');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
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
    queryKey: ['admin-events-in-review', q, tagFilter, workerFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({
        status: 'in_review',
        sort: 'created',
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (q) params.set('q', q);
      if (tagFilter === NO_TAGS) params.set('untagged', 'true');
      if (workerFilter) params.set('worker', workerFilter);
      return adminFetch<ReviewPage>(`/events?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
    retry: false,
  });

  const lastPage = list.data ? Math.max(0, Math.ceil(list.data.total / PAGE_SIZE) - 1) : null;
  if (lastPage != null && page > lastPage) setPage(lastPage);

  const decide = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'reject' | 'rescan' }) =>
      adminFetch(`/events/${input.id}/${input.action}`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
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
          if (input.action === 'rescan') {
            return adminFetch(`/events/${id}/rescan`, { method: 'POST' });
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
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
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
    const ids =
      action === 'wipe' || action === 'delete' || action === 'rescan' ? importedIds : selectedIds;
    if (ids.length === 0) return;
    setBulkError(false);
    bulk.mutate({ action, ids });
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const Title = embedded ? 'h2' : 'h1';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Title className={embedded ? 'text-xl font-semibold' : 'text-2xl font-semibold'}>
          {t('reviewTitle')}
        </Title>
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
              disabled={importedIds.length === 0 || busy}
              onClick={() => setConfirmDelete(true)}
            >
              {t('delete')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={importedIds.length === 0 || busy}
              onClick={() => setConfirmWipe(true)}
            >
              {t('wipe')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={importedIds.length === 0 || busy}
              onClick={() => runBulk('rescan')}
            >
              {t('rescan')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={selectedIds.length === 0 || busy}
              onClick={() => runBulk('reject')}
            >
              {t('reject')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={selectedIds.length === 0 || busy}
              onClick={() => runBulk('approve')}
            >
              {t('approve')}
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
          <FieldLabel htmlFor="review-search">{t('search')}</FieldLabel>
          <Input
            id="review-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </Field>
        <Field className="w-full min-w-[180px] max-w-60">
          <FieldLabel htmlFor="review-tags">{t('tagsFilter')}</FieldLabel>
          <Select
            items={{
              [ALL_TAGS]: t('allTags'),
              [NO_TAGS]: t('noTags'),
            }}
            value={tagFilter === '' ? ALL_TAGS : tagFilter}
            onValueChange={(next) => {
              if (next == null) return;
              setTagFilter(next === ALL_TAGS ? '' : next);
              setPage(0);
              setSelected(new Set());
            }}
          >
            <SelectTrigger id="review-tags" className="w-full">
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
        <WorkerFilter
          id="review-worker"
          label={t('worker')}
          allLabel={t('allWorkers')}
          value={workerFilter}
          onValueChange={(next) => {
            setWorkerFilter(next);
            setPage(0);
            setSelected(new Set());
          }}
        />
      </div>
      {waitingForPage ? <LoadingRows /> : null}
      {!waitingForPage && items.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title={q || tagFilter || workerFilter ? t('reviewNoMatch') : t('reviewEmpty')}
        />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b ">
              <TableRow>
                <TableHead>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={() => toggleAll()}
                    aria-label={t('selectAll')}
                  />
                </TableHead>
                <TableHead>{t('title')}</TableHead>
                <TableHead>{t('tags')}</TableHead>
                <TableHead>{t('publisher')}</TableHead>
                <TableHead>{t('worker')}</TableHead>
                <TableHead>{t('starts')}</TableHead>
                <TableHead>{t('venue')}</TableHead>
                <TableHead>{tVerdict('label')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const source = httpUrl(item.sourceUrl);
                return (
                  <TableRow
                    key={item.id}
                    data-state={selected.has(item.id) ? 'selected' : undefined}
                  >
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
                        <Link href={`/events/${item.id}`} className="underline underline-offset-4">
                          {item.title}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      <EventTagCount count={item.tagCount} />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/publishers/${item.publisherId}`}
                        className="underline underline-offset-4"
                      >
                        {item.publisherName}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{item.workerId ?? '—'}</TableCell>
                    <TableCell>
                      {item.startsAt ? new Date(item.startsAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>{item.venueName ?? '—'}</TableCell>
                    <TableCell>
                      <ContentVerdictChip verdict={item.contentVerdict} />
                    </TableCell>
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
                          <DropdownMenuGroup>
                            {source ? (
                              <DropdownMenuItem
                                render={
                                  <a href={source} target="_blank" rel="noopener noreferrer" />
                                }
                              >
                                {t('view')}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              disabled={busy}
                              onClick={() => decide.mutate({ id: item.id, action: 'approve' })}
                            >
                              {t('approve')}
                            </DropdownMenuItem>
                            {item.origin === 'imported' ? (
                              <DropdownMenuItem
                                disabled={busy}
                                onClick={() => decide.mutate({ id: item.id, action: 'rescan' })}
                              >
                                {t('rescan')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={busy}
                              onClick={() => decide.mutate({ id: item.id, action: 'reject' })}
                            >
                              {t('reject')}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
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
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteConfirmBody', { count: importedIds.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || importedIds.length === 0}
              onClick={() => runBulk('delete')}
            >
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmWipe}
        onOpenChange={(open) => {
          if (!open) setConfirmWipe(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('wipeConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('wipeConfirmBody', { count: importedIds.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmWipe(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || importedIds.length === 0}
              onClick={() => runBulk('wipe')}
            >
              {t('wipe')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
