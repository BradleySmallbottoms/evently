'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Checkbox } from '@/components/ui/checkbox';
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

const OCCASION_PREVIEW = 10;

type Occasion = {
  startsAt: string;
  endsAt?: string;
  venueName?: string;
};

type GroupItem = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  venueName: string | null;
};

export function EventOccasions({
  eventId,
  occasions,
  occasionGroupId,
  onCollapsed,
}: {
  eventId: string;
  occasions: Occasion[] | undefined;
  occasionGroupId: string | undefined;
  onCollapsed: () => void;
}) {
  const t = useTranslations('EventEditor');
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [showAllOccasions, setShowAllOccasions] = useState(false);
  const stored = occasions ?? [];
  const visibleOccasions = showAllOccasions ? stored : stored.slice(0, OCCASION_PREVIEW);

  const group = useQuery({
    queryKey: ['admin-event-occasion-group', eventId, occasionGroupId],
    queryFn: () => adminFetch<{ items: GroupItem[] }>(`/events/${eventId}/occasion-group`),
    enabled: Boolean(occasionGroupId),
    retry: false,
  });

  const collapse = useMutation({
    mutationFn: (eventIds: string[]) =>
      adminFetch(`/events/${eventId}/collapse`, {
        method: 'POST',
        body: JSON.stringify({ eventIds }),
      }),
    onSuccess: async () => {
      setSelected(new Set());
      setError(false);
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ['admin-event', eventId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-event-occasion-group', eventId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      onCollapsed();
    },
    onError: () => setError(true),
  });

  const items = group.data?.items ?? [];
  const selectable = items.filter((item) => item.id !== eventId);
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    setError(false);
    setDone(false);
    setSelected(allSelected ? new Set() : new Set(selectable.map((item) => item.id)));
  }

  function toggle(id: string) {
    setError(false);
    setDone(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {done ? (
        <Alert>
          <AlertDescription>{t('collapsed')}</AlertDescription>
        </Alert>
      ) : null}
      {stored.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('occasionsTitle')}</h2>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="rounded-t-lg border-b bg-muted">
                <TableRow>
                  <TableHead>{t('startsAt')}</TableHead>
                  <TableHead>{t('endsAt')}</TableHead>
                  <TableHead>{t('venueName')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOccasions.map((occasion) => (
                  <TableRow key={`${occasion.startsAt}-${occasion.endsAt ?? ''}`}>
                    <TableCell>{new Date(occasion.startsAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {occasion.endsAt ? new Date(occasion.endsAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>{occasion.venueName ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {stored.length > OCCASION_PREVIEW && !showAllOccasions ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAllOccasions(true)}
            >
              {t('showMoreOccasions')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {occasionGroupId ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-row items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={selected.size === 0 || collapse.isPending}
              onClick={() => collapse.mutate([...selected])}
            >
              {collapse.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('collapse')}
            </Button>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{t('collapseError')}</AlertDescription>
            </Alert>
          ) : null}
          {group.isLoading ? <LoadingRows /> : null}
          {group.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{t('collapseError')}</AlertDescription>
            </Alert>
          ) : null}
          {!group.isLoading && items.length === 0 ? (
            <EmptyState icon={CalendarIcon} title={t('groupEmpty')} />
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
                        disabled={selectable.length === 0}
                        onCheckedChange={() => toggleAll()}
                        aria-label={t('selectAll')}
                      />
                    </TableHead>
                    <TableHead>{t('name')}</TableHead>
                    <TableHead>{t('startsAt')}</TableHead>
                    <TableHead>{t('endsAt')}</TableHead>
                    <TableHead>{t('venueName')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const current = item.id === eventId;
                    return (
                      <TableRow
                        key={item.id}
                        data-state={selected.has(item.id) ? 'selected' : undefined}
                        className={current ? 'text-muted-foreground' : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            checked={current ? false : selected.has(item.id)}
                            disabled={current}
                            onCheckedChange={() => toggle(item.id)}
                            aria-label={
                              current
                                ? t('currentOccasion')
                                : t('selectOccasion', { title: item.title })
                            }
                          />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {current ? (
                            item.title
                          ) : (
                            <Link
                              href={`/events/${item.id}`}
                              className="underline underline-offset-4"
                            >
                              {item.title}
                            </Link>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.startsAt ? new Date(item.startsAt).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell>
                          {item.endsAt ? new Date(item.endsAt).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell>{item.venueName ?? '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
