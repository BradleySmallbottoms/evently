'use client';

import { useQuery } from '@tanstack/react-query';
import { BellIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
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

type SentNotification = {
  id: string;
  status: 'sending' | 'sent';
  audience: string;
  audienceTagName: string | null;
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
  sentAt: string | null;
  recipientCount: number;
};

function audienceLabel(
  row: SentNotification,
  t: ReturnType<typeof useTranslations<'EventEditor'>>,
): string {
  if (row.audience === 'area') return t('audienceArea');
  if (row.audience === 'area_and_tag') return t('audienceAreaAndTag');
  if (row.audience === 'everyone') return t('audienceEveryone');
  if (row.audience === 'tag_interest') {
    return t('audienceTag', { tag: row.audienceTagName ?? '—' });
  }
  return t('audienceEventMatch');
}

export function SentNotifications({ eventId }: { eventId: string }) {
  const t = useTranslations('EventEditor');
  const locale = useLocale();
  const list = useQuery({
    queryKey: ['admin-event-sent-notifications', eventId],
    queryFn: () =>
      adminFetch<{ items: SentNotification[] }>(`/events/${eventId}/sent-notifications`),
  });

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t('sentNotifications')}</h2>
      {list.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('sentNotificationsError')}</AlertDescription>
        </Alert>
      ) : null}
      {list.isLoading ? <LoadingRows /> : null}
      {list.data?.items.length === 0 ? (
        <EmptyState icon={BellIcon} title={t('sentNotificationsEmpty')} />
      ) : null}
      {(list.data?.items.length ?? 0) > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead>{t('colSent')}</TableHead>
                <TableHead>{t('colMessage')}</TableHead>
                <TableHead>{t('colAudience')}</TableHead>
                <TableHead className="text-right">{t('colRecipients')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((row) => {
                const title = locale === 'en' ? row.titleEn : row.titleSv;
                const body = locale === 'en' ? row.bodyEn : row.bodySv;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.sentAt
                        ? new Date(row.sentAt).toLocaleString(locale)
                        : t('statusSending')}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <p className="text-sm">{title}</p>
                      <p className="block text-xs text-muted-foreground">{body}</p>
                    </TableCell>
                    <TableCell>{audienceLabel(row, t)}</TableCell>
                    <TableCell className="text-right">{row.recipientCount}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/push-messages/${row.id}`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        {t('openNotification')}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
