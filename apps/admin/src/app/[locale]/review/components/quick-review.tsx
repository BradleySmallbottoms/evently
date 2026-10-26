'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useEffect, useState } from 'react';
import { possibleDuplicatesQuery } from '../../events/[id]/components/event-occasions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

type Occasion = {
  id: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
};

type ReviewEvent = {
  id: string;
  title: string;
  description: string | null;
  summary: string | null;
  timezone: string;
  imageUrl: string | null;
  occasions?: Occasion[];
  meta: { possibleOccasionGroupId?: string };
};

type GroupItem = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  venueName: string | null;
};

const OCCASION_PAGE_SIZE = 10;

function formatWhen(iso: string | null, timeZone: string, locale: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function QuickReview({
  eventId,
  index,
  count,
  onPrevious,
  onNext,
  onMerged,
}: {
  eventId: string;
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
  onMerged: () => void;
}) {
  const t = useTranslations('Events');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [groupSelected, setGroupSelected] = useState<Set<string>>(new Set());
  const [duplicateSelected, setDuplicateSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const [decideError, setDecideError] = useState(false);
  const [done, setDone] = useState(false);
  const [marked, setMarked] = useState(false);
  const [occasionPage, setOccasionPage] = useState(0);

  const detail = useQuery({
    queryKey: ['admin-event', eventId],
    queryFn: () => adminFetch<ReviewEvent>(`/events/${eventId}`),
    retry: false,
  });
  const duplicates = useQuery({
    ...possibleDuplicatesQuery(eventId),
    retry: false,
  });
  const groupId = detail.data?.meta.possibleOccasionGroupId;
  const group = useQuery({
    queryKey: ['admin-event-occasion-group', eventId, groupId],
    queryFn: () => adminFetch<{ items: GroupItem[] }>(`/events/${eventId}/occasion-group`),
    enabled: Boolean(groupId),
    retry: false,
  });

  const duplicateItems = duplicates.data?.items ?? [];
  const duplicateIds = new Set(duplicateItems.map((item) => item.id));
  const groupItems = (group.data?.items ?? []).filter(
    (item) => item.id !== eventId && !duplicateIds.has(item.id),
  );
  const duplicateKey = duplicateItems.map((item) => item.id).join(',');
  const groupKey = groupItems.map((item) => item.id).join(',');

  useEffect(() => {
    setDuplicateSelected(new Set(duplicateKey ? duplicateKey.split(',') : []));
    setGroupSelected(new Set(groupKey ? groupKey.split(',') : []));
  }, [duplicateKey, groupKey]);

  useEffect(() => {
    setDone(false);
    setMarked(false);
    setError(false);
    setDecideError(false);
    setOccasionPage(0);
  }, [eventId]);

  async function refreshMerged() {
    await queryClient.invalidateQueries({ queryKey: ['admin-event', eventId] });
    await queryClient.invalidateQueries({
      queryKey: ['admin-event-possible-duplicates', eventId],
    });
    await queryClient.invalidateQueries({ queryKey: ['admin-event-occasion-group', eventId] });
    await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
  }

  const merge = useMutation({
    mutationFn: async () => {
      const hideIds = [...duplicateSelected];
      const foldIds = [...groupSelected].filter((id) => !duplicateSelected.has(id));
      if (foldIds.length > 0) {
        await adminFetch(`/events/${eventId}/collapse`, {
          method: 'POST',
          body: JSON.stringify({ eventIds: foldIds }),
        });
      }
      if (hideIds.length > 0) {
        await adminFetch(`/events/${eventId}/merge-duplicates`, {
          method: 'POST',
          body: JSON.stringify({ eventIds: hideIds, occasions: 'move' }),
        });
      }
    },
    onSuccess: async () => {
      setError(false);
      setDecideError(false);
      setMarked(false);
      setDone(true);
      await refreshMerged();
      onMerged();
    },
    onError: async () => {
      setError(true);
      await refreshMerged();
    },
  });

  const decide = useMutation({
    mutationFn: async (action: 'approve' | 'reject') =>
      adminFetch(`/events/${eventId}/${action}`, { method: 'POST' }),
    onSuccess: async () => {
      setDecideError(false);
      await refreshMerged();
      onMerged();
    },
    onError: () => setDecideError(true),
  });

  const markDuplicate = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/events/${eventId}/merge-duplicates`, {
        method: 'POST',
        body: JSON.stringify({ eventIds: [id], occasions: 'keep' }),
      }),
    onSuccess: async () => {
      setError(false);
      setDone(false);
      setMarked(true);
      await refreshMerged();
      onMerged();
    },
    onError: async () => {
      setError(true);
      await refreshMerged();
    },
  });

  const markCurrent = useMutation({
    mutationFn: async () => {
      const [keeperId] = [...duplicateSelected];
      if (duplicateSelected.size !== 1 || !keeperId) throw new Error('invalid_event');
      await adminFetch(`/events/${keeperId}/merge-duplicates`, {
        method: 'POST',
        body: JSON.stringify({ eventIds: [eventId], occasions: 'keep' }),
      });
    },
    onSuccess: async () => {
      setError(false);
      setDone(false);
      setMarked(true);
      await refreshMerged();
      onMerged();
    },
    onError: async () => {
      setError(true);
      await refreshMerged();
    },
  });

  const event = detail.data;
  const timeZone = event?.timezone ?? 'Europe/Stockholm';
  const occasions = event?.occasions ?? [];
  const occasionCount = occasions.length;
  const occasionPageCount = Math.max(1, Math.ceil(occasionCount / OCCASION_PAGE_SIZE));
  const occasionAt = Math.min(occasionPage, occasionPageCount - 1);
  const occasionRows = occasions.slice(
    occasionAt * OCCASION_PAGE_SIZE,
    (occasionAt + 1) * OCCASION_PAGE_SIZE,
  );
  const canMerge = groupSelected.size > 0 || duplicateSelected.size > 0;

  const pending =
    merge.isPending || decide.isPending || markDuplicate.isPending || markCurrent.isPending;

  function toggle(set: typeof setGroupSelected, id: string) {
    setError(false);
    setDecideError(false);
    setDone(false);
    setMarked(false);
    set((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('quickReview')}</CardTitle>
        <CardDescription>{t('quickReviewCount', { current: index + 1, count })}</CardDescription>
        <CardAction>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index === 0}
              onClick={onPrevious}
            >
              {t('quickPrevious')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index >= count - 1}
              onClick={onNext}
            >
              {t('quickNext')}
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {detail.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('quickLoading')}</p>
        ) : null}
        {detail.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t('loadError')}</AlertDescription>
          </Alert>
        ) : null}
        {event ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            {event.imageUrl ? (
              <img
                src={event.imageUrl}
                alt=""
                className="size-36 shrink-0 rounded-lg object-cover"
              />
            ) : null}
            <div className="flex min-w-0 flex-col gap-2">
              <Link
                href={`/events/${event.id}`}
                className="text-lg font-semibold underline underline-offset-4"
              >
                {event.title}
              </Link>
              <h3 className="font-medium">{t('description')}</h3>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {event.description || '—'}
              </p>
            </div>
          </div>
        ) : null}
        {occasionCount > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">{t('occasions')}</h3>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="border-b bg-muted">
                  <TableRow>
                    <TableHead>{t('starts')}</TableHead>
                    <TableHead>{t('ends')}</TableHead>
                    <TableHead>{t('venue')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {occasionRows.map((occasion) => (
                    <TableRow key={occasion.id}>
                      <TableCell>{formatWhen(occasion.startsAt, timeZone, locale)}</TableCell>
                      <TableCell>{formatWhen(occasion.endsAt, timeZone, locale)}</TableCell>
                      <TableCell>{occasion.venueName ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {occasionCount > OCCASION_PAGE_SIZE ? (
              <div className="flex items-center justify-end gap-2">
                <p className="text-sm text-muted-foreground">
                  {t('pageRange', {
                    from: occasionAt * OCCASION_PAGE_SIZE + 1,
                    to: Math.min(occasionCount, (occasionAt + 1) * OCCASION_PAGE_SIZE),
                    count: occasionCount,
                  })}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('pagePrev')}
                  disabled={occasionAt === 0}
                  onClick={() => setOccasionPage(occasionAt - 1)}
                >
                  {t('pagePrev')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('pageNext')}
                  disabled={occasionAt >= occasionPageCount - 1}
                  onClick={() => setOccasionPage(occasionAt + 1)}
                >
                  {t('pageNext')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {event ? (
          <div className="flex flex-col gap-1">
            <h3 className="font-medium">{t('summary')}</h3>
            <p className="whitespace-pre-wrap text-muted-foreground">{event.summary || '—'}</p>
          </div>
        ) : null}
        <DuplicateTable
          title={t('possibleDuplicates')}
          empty={t('quickNone')}
          loading={duplicates.isLoading}
          loadingLabel={t('quickLoading')}
          items={duplicateItems}
          selected={duplicateSelected}
          onToggle={(id) => toggle(setDuplicateSelected, id)}
          onToggleAll={() => {
            setError(false);
            setDecideError(false);
            setDone(false);
            setMarked(false);
            setDuplicateSelected(
              duplicateItems.length > 0 &&
                duplicateItems.every((item) => duplicateSelected.has(item.id))
                ? new Set()
                : new Set(duplicateItems.map((item) => item.id)),
            );
          }}
          timeZone={timeZone}
          locale={locale}
          labels={{
            selectAll: t('selectAll'),
            selectRow: (values) => t('selectRow', values),
            name: t('title'),
            location: t('location'),
            importer: t('importer'),
            starts: t('starts'),
            ends: t('ends'),
            venue: t('venue'),
            mark: t('markAsDuplicate'),
          }}
          markingId={markDuplicate.isPending ? markDuplicate.variables : undefined}
          markDisabled={pending}
          onMark={(id) => markDuplicate.mutate(id)}
        />
        <CandidateTable
          title={t('occasionGroup')}
          empty={t('quickNone')}
          loading={Boolean(groupId) && group.isLoading}
          loadingLabel={t('quickLoading')}
          rows={groupItems.map((item) => ({
            id: item.id,
            title: item.title,
            detail: [formatWhen(item.startsAt, timeZone, locale), item.venueName ?? '—'].join(
              ' · ',
            ),
          }))}
          selected={groupSelected}
          onToggle={(id) => toggle(setGroupSelected, id)}
          selectLabel={(values) => t('selectRow', values)}
        />
        {done ? (
          <Alert>
            <AlertDescription>{t('quickMerged')}</AlertDescription>
          </Alert>
        ) : null}
        {marked ? (
          <Alert>
            <AlertDescription>{t('quickMarked')}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{t('quickMergeError')}</AlertDescription>
          </Alert>
        ) : null}
        {decideError ? (
          <Alert variant="destructive">
            <AlertDescription>{t('quickDecideError')}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => decide.mutate('reject')}
        >
          {decide.isPending && decide.variables === 'reject' ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          {t('reject')}
        </Button>
        <Button type="button" disabled={pending} onClick={() => decide.mutate('approve')}>
          {decide.isPending && decide.variables === 'approve' ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          {t('approve')}
        </Button>
        <Button type="button" disabled={!canMerge || pending} onClick={() => merge.mutate()}>
          {merge.isPending ? <Spinner data-icon="inline-start" /> : null}
          {t('merge')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={duplicateSelected.size !== 1 || pending}
          onClick={() => markCurrent.mutate()}
        >
          {markCurrent.isPending ? <Spinner data-icon="inline-start" /> : null}
          {t('markAsDuplicate')}
        </Button>
      </CardFooter>
    </Card>
  );
}

function DuplicateTable({
  title,
  empty,
  loading,
  loadingLabel,
  items,
  selected,
  onToggle,
  onToggleAll,
  timeZone,
  locale,
  labels,
  markingId,
  markDisabled,
  onMark,
}: {
  title: string;
  empty: string;
  loading: boolean;
  loadingLabel: string;
  items: {
    id: string;
    title: string;
    location: string | null;
    workerId: string | null;
    occasions: { id: string; startsAt: string; endsAt: string; venueName: string | null }[];
  }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  timeZone: string;
  locale: string;
  labels: {
    selectAll: string;
    selectRow: (values: { title: string }) => string;
    name: string;
    location: string;
    importer: string;
    starts: string;
    ends: string;
    venue: string;
    mark: string;
  };
  markingId: string | undefined;
  markDisabled: boolean;
  onMark: (id: string) => void;
}) {
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const someSelected = items.some((item) => selected.has(item.id)) && !allSelected;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      {loading ? <p className="text-sm text-muted-foreground">{loadingLabel}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="border-b bg-muted">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={onToggleAll}
                    aria-label={labels.selectAll}
                  />
                </TableHead>
                <TableHead>{labels.name}</TableHead>
                <TableHead>{labels.location}</TableHead>
                <TableHead>{labels.importer}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <Fragment key={item.id}>
                  <TableRow data-state={selected.has(item.id) ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => onToggle(item.id)}
                        aria-label={labels.selectRow({ title: item.title })}
                      />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Link href={`/events/${item.id}`} className="underline underline-offset-4">
                        {item.title}
                      </Link>
                    </TableCell>
                    <TableCell>{item.location ?? '—'}</TableCell>
                    <TableCell>{item.workerId ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={markDisabled}
                        onClick={() => onMark(item.id)}
                      >
                        {markingId === item.id ? <Spinner data-icon="inline-start" /> : null}
                        {labels.mark}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {item.occasions.map((occasion) => (
                    <TableRow key={occasion.id} className="bg-muted/40">
                      <TableCell />
                      <TableCell colSpan={4} className="pl-8">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-xs text-muted-foreground">{labels.starts}</div>
                            {formatWhen(occasion.startsAt, timeZone, locale)}
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">{labels.ends}</div>
                            {formatWhen(occasion.endsAt, timeZone, locale)}
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">{labels.venue}</div>
                            {occasion.venueName ?? '—'}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function CandidateTable({
  title,
  empty,
  loading,
  loadingLabel,
  rows,
  selected,
  onToggle,
  selectLabel,
}: {
  title: string;
  empty: string;
  loading: boolean;
  loadingLabel: string;
  rows: { id: string; title: string; detail: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  selectLabel: (values: { title: string }) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      {loading ? <p className="text-sm text-muted-foreground">{loadingLabel}</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                  <TableCell className="w-10">
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => onToggle(row.id)}
                      aria-label={selectLabel({ title: row.title })}
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link href={`/events/${row.id}`} className="underline underline-offset-4">
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
