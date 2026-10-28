'use client';

import type { AdminPossibleDuplicateItem } from '@local-events/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import type { FormEvent } from 'react';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { AdminApiError, adminFetch } from '@/lib/api';
import { toDatetimeLocal, zonedLocalToIso } from '@/lib/zoned-datetime';

const OCCASION_PREVIEW = 10;

function formatWhen(iso: string | null, timeZone: string, locale: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

type Occasion = {
  id: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
};

type GroupItem = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  venueName: string | null;
};

export type PossibleDuplicate = Pick<
  AdminPossibleDuplicateItem,
  'id' | 'title' | 'location' | 'workerId' | 'occasions'
>;

export function possibleDuplicatesQuery(eventId: string) {
  return {
    queryKey: ['admin-event-possible-duplicates', eventId] as const,
    queryFn: () =>
      adminFetch<{ items: PossibleDuplicate[] }>(`/events/${eventId}/possible-duplicates`),
  };
}

function OccasionEditor({
  eventId,
  occasion,
  timeZone,
  onClose,
  onSaved,
}: {
  eventId: string;
  occasion: Occasion;
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('EventEditor');
  const queryClient = useQueryClient();
  const startLocal = toDatetimeLocal(occasion.startsAt, timeZone);
  const endLocal = toDatetimeLocal(occasion.endsAt, timeZone);
  const [date, setDate] = useState(startLocal.slice(0, 10));
  const [startTime, setStartTime] = useState(startLocal.slice(11, 16));
  const [endTime, setEndTime] = useState(endLocal.slice(11, 16));
  const [venueName, setVenueName] = useState(occasion.venueName ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { startsAt: string; endsAt: string; venueName: string | null }) =>
      adminFetch(`/events/${eventId}/occasions/${occasion.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-event', eventId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
      onSaved();
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof AdminApiError && err.code === 'invalid_event'
          ? t('occasionTimeError')
          : t('occasionSaveError'),
      );
    },
  });

  function onSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^\d{2}:\d{2}$/.test(startTime) ||
      !/^\d{2}:\d{2}$/.test(endTime)
    ) {
      setError(t('invalidTime'));
      return;
    }
    let startsAt: string;
    let endsAt: string;
    try {
      startsAt = zonedLocalToIso(`${date}T${startTime}`, timeZone);
      endsAt = zonedLocalToIso(`${date}T${endTime}`, timeZone);
    } catch {
      setError(t('invalidTime'));
      return;
    }
    if (new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
      setError(t('occasionTimeError'));
      return;
    }
    save.mutate({ startsAt, endsAt, venueName: venueName.trim() || null });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editOccasion')}</DialogTitle>
          <DialogDescription>{t('editOccasionHint')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="occasion-date">{t('occasionDate')}</FieldLabel>
            <Input
              id="occasion-date"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="occasion-start">{t('occasionStart')}</FieldLabel>
              <Input
                id="occasion-start"
                type="time"
                required
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="occasion-end">{t('occasionEnd')}</FieldLabel>
              <Input
                id="occasion-end"
                type="time"
                required
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="occasion-venue">{t('venueName')}</FieldLabel>
            <Input
              id="occasion-venue"
              value={venueName}
              onChange={(event) => setVenueName(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EventOccasions({
  eventId,
  occasions,
  possibleOccasionGroupId,
  timeZone,
  onCollapsed,
  onMerged,
  onSaved,
}: {
  eventId: string;
  occasions: Occasion[] | undefined;
  possibleOccasionGroupId: string | undefined;
  timeZone: string;
  onCollapsed: () => void;
  onMerged: (occasions: 'keep' | 'move') => void;
  onSaved: () => void;
}) {
  const t = useTranslations('EventEditor');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [duplicateSelected, setDuplicateSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [mergeError, setMergeError] = useState(false);
  const [merged, setMerged] = useState<'keep' | 'move' | null>(null);
  const [showAllOccasions, setShowAllOccasions] = useState(false);
  const [editing, setEditing] = useState<Occasion | null>(null);
  const stored = occasions ?? [];
  const visibleOccasions = showAllOccasions ? stored : stored.slice(0, OCCASION_PREVIEW);

  const group = useQuery({
    queryKey: ['admin-event-occasion-group', eventId, possibleOccasionGroupId],
    queryFn: () => adminFetch<{ items: GroupItem[] }>(`/events/${eventId}/occasion-group`),
    enabled: Boolean(possibleOccasionGroupId),
    retry: false,
  });
  const duplicates = useQuery({
    ...possibleDuplicatesQuery(eventId),
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

  const merge = useMutation({
    mutationFn: (input: { eventIds: string[]; occasions: 'keep' | 'move' }) =>
      adminFetch(`/events/${eventId}/merge-duplicates`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: async (_result, input) => {
      setDuplicateSelected(new Set());
      setMergeError(false);
      setMerged(input.occasions);
      await queryClient.invalidateQueries({ queryKey: ['admin-event', eventId] });
      await queryClient.invalidateQueries({
        queryKey: ['admin-event-possible-duplicates', eventId],
      });
      await queryClient.invalidateQueries({ queryKey: ['admin-event-occasion-group', eventId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
      onMerged(input.occasions);
    },
    onError: () => setMergeError(true),
  });

  const duplicateItems = duplicates.data?.items ?? [];
  const allDuplicatesSelected =
    duplicateItems.length > 0 && duplicateItems.every((item) => duplicateSelected.has(item.id));
  const someDuplicatesSelected = duplicateSelected.size > 0 && !allDuplicatesSelected;
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

  function toggleDuplicate(id: string) {
    setMergeError(false);
    setMerged(null);
    setDuplicateSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllDuplicates() {
    setMergeError(false);
    setMerged(null);
    setDuplicateSelected(
      allDuplicatesSelected ? new Set() : new Set(duplicateItems.map((item) => item.id)),
    );
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
                  <TableHead className="w-24">
                    <span className="sr-only">{t('editOccasion')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOccasions.map((occasion) => (
                  <TableRow key={occasion.id}>
                    <TableCell>{formatWhen(occasion.startsAt, timeZone, locale)}</TableCell>
                    <TableCell>{formatWhen(occasion.endsAt, timeZone, locale)}</TableCell>
                    <TableCell>{occasion.venueName ?? '—'}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(occasion)}
                      >
                        {t('editOccasion')}
                      </Button>
                    </TableCell>
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
          {editing ? (
            <OccasionEditor
              key={editing.id}
              eventId={eventId}
              occasion={editing}
              timeZone={timeZone}
              onClose={() => setEditing(null)}
              onSaved={onSaved}
            />
          ) : null}
        </div>
      ) : null}
      {duplicates.isLoading ? <LoadingRows /> : null}
      {duplicates.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('duplicatesError')}</AlertDescription>
        </Alert>
      ) : null}
      {merged ? (
        <Alert>
          <AlertDescription>
            {merged === 'move' ? t('mergedOccasions') : t('merged')}
          </AlertDescription>
        </Alert>
      ) : null}
      {duplicateItems.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{t('possibleDuplicates')}</h2>
            <p className="text-sm text-muted-foreground">{t('duplicateHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={duplicateSelected.size === 0 || merge.isPending}
              onClick={() => merge.mutate({ eventIds: [...duplicateSelected], occasions: 'keep' })}
            >
              {merge.isPending && merge.variables?.occasions === 'keep' ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {t('mergeDuplicates')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={duplicateSelected.size === 0 || merge.isPending}
              onClick={() => merge.mutate({ eventIds: [...duplicateSelected], occasions: 'move' })}
            >
              {merge.isPending && merge.variables?.occasions === 'move' ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {t('mergeDuplicateOccasions')}
            </Button>
          </div>
          {mergeError ? (
            <Alert variant="destructive">
              <AlertDescription>
                {merge.variables?.occasions === 'move' ? t('mergeOccasionsError') : t('mergeError')}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="rounded-t-lg border-b bg-muted">
                <TableRow>
                  <TableHead>
                    <Checkbox
                      checked={allDuplicatesSelected}
                      indeterminate={someDuplicatesSelected}
                      onCheckedChange={() => toggleAllDuplicates()}
                      aria-label={t('selectAll')}
                    />
                  </TableHead>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('location')}</TableHead>
                  <TableHead>{t('importer')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {duplicateItems.map((item) => (
                  <Fragment key={item.id}>
                    <TableRow data-state={duplicateSelected.has(item.id) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={duplicateSelected.has(item.id)}
                          onCheckedChange={() => toggleDuplicate(item.id)}
                          aria-label={t('selectOccasion', { title: item.title })}
                        />
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Link href={`/events/${item.id}`} className="underline underline-offset-4">
                          {item.title}
                        </Link>
                      </TableCell>
                      <TableCell>{item.location ?? '—'}</TableCell>
                      <TableCell>{item.workerId ?? '—'}</TableCell>
                    </TableRow>
                    {item.occasions.map((occasion) => (
                      <TableRow key={occasion.id} className="bg-muted/40">
                        <TableCell />
                        <TableCell colSpan={3} className="pl-8">
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <div className="text-xs text-muted-foreground">{t('startsAt')}</div>
                              {formatWhen(occasion.startsAt, timeZone, locale)}
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">{t('endsAt')}</div>
                              {formatWhen(occasion.endsAt, timeZone, locale)}
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">{t('venueName')}</div>
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
        </div>
      ) : null}
      {possibleOccasionGroupId ? (
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
                        <TableCell>{formatWhen(item.startsAt, timeZone, locale)}</TableCell>
                        <TableCell>{formatWhen(item.endsAt, timeZone, locale)}</TableCell>
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
