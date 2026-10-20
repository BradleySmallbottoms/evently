'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { API_URL } from '@/lib/api';

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
  t: ReturnType<typeof useTranslations<'Events'>>,
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
  const t = useTranslations('Events');
  const locale = useLocale();
  const list = useQuery({
    queryKey: ['event-sent-notifications', eventId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/manage/events/${eventId}/sent-notifications`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('sent_notifications_load_failed');
      return (await res.json()) as { items: SentNotification[] };
    },
    enabled: Boolean(eventId),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold text-foreground">{t('sentNotifications')}</h2>
      {list.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('sentNotificationsError')}</AlertDescription>
        </Alert>
      ) : null}
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('sentNotificationsLoading')}</p>
      ) : null}
      {list.data?.items.length === 0 ? (
        <Alert>
          <AlertDescription>{t('sentNotificationsEmpty')}</AlertDescription>
        </Alert>
      ) : null}
      {(list.data?.items.length ?? 0) > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colSent')}</TableHead>
              <TableHead>{t('colMessage')}</TableHead>
              <TableHead>{t('colAudience')}</TableHead>
              <TableHead className="text-right">{t('colRecipients')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.items.map((row) => {
              const title = locale === 'en' ? row.titleEn : row.titleSv;
              const body = locale === 'en' ? row.bodyEn : row.bodySv;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.sentAt ? new Date(row.sentAt).toLocaleString(locale) : t('statusSending')}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <p className="text-sm text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground">{body}</p>
                  </TableCell>
                  <TableCell>{audienceLabel(row, t)}</TableCell>
                  <TableCell className="text-right">{row.recipientCount}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
