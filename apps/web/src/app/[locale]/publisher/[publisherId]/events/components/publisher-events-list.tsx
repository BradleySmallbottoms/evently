'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AppLink } from '@/components/app-link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { api, throwIfError } from '@/lib/api';

function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'published') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
}

export function PublisherEventsList() {
  const t = useTranslations('Events');
  const { publisherId } = useParams<{ publisherId: string }>();
  const list = useQuery({
    queryKey: ['publisher-events', publisherId],
    queryFn: async () =>
      throwIfError(
        await api.GET('/publishers/{publisherId}/events', {
          params: { path: { publisherId } },
        }),
      ),
    retry: false,
  });

  if (list.isPending) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (list.isError) {
    return <p className="text-sm text-destructive">{t('loadError')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {t('publisherEventsTitle')}
        </h1>
        <AppLink
          href={`/publisher/${publisherId}/events/new`}
          className={buttonVariants({ variant: 'brand' })}
        >
          {t('newEvent')}
        </AppLink>
      </div>

      {list.data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('noEvents')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {list.data.items.map((event) => (
            <li
              key={event.id}
              className="rounded-2xl bg-card p-4 text-card-foreground ring-1 ring-border"
            >
              <div className="flex flex-row flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-medium text-foreground">{event.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {new Date(event.startsAt).toLocaleString()} -{' '}
                    {new Date(event.endsAt).toLocaleString()}
                  </p>
                </div>
                <Badge variant={statusVariant(event.status)}>{t(`status.${event.status}`)}</Badge>
              </div>
              <div className="mt-3">
                <AppLink
                  href={`/publisher/${publisherId}/events/${event.id}`}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  {t('editEvent')}
                </AppLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
