'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

type PublisherEvent = {
  id: string;
  title: string;
  status: string;
  startsAt: string | null;
  venueName: string | null;
};

export function PublisherEvents({ publisherId }: { publisherId: string }) {
  const t = useTranslations('PublisherEditor');

  const events = useQuery({
    queryKey: ['admin-publisher-events', publisherId],
    queryFn: () =>
      adminFetch<{ items: PublisherEvent[]; total: number }>(`/publishers/${publisherId}/events`),
    retry: false,
  });

  const items = events.data?.items ?? [];
  const total = events.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('events')}</h2>
      {events.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('eventsLoadError')}</AlertDescription>
        </Alert>
      ) : null}
      {events.isLoading ? <LoadingRows /> : null}
      {events.data && items.length === 0 ? (
        <EmptyState icon={CalendarIcon} title={t('eventsEmpty')} />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead>{t('colId')}</TableHead>
                <TableHead>{t('colTitle')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>{t('colStarts')}</TableHead>
                <TableHead>{t('colVenue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.id}</TableCell>
                  <TableCell>
                    <Link
                      href={`/events/${item.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell>{item.status}</TableCell>
                  <TableCell>
                    {item.startsAt ? new Date(item.startsAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>{item.venueName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {events.data && total > items.length ? (
        <p className="text-sm text-muted-foreground">
          {t('eventsShowing', { shown: items.length, total })}
        </p>
      ) : null}
    </div>
  );
}
