'use client';

import { useQuery } from '@tanstack/react-query';
import { BellIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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

type PushMessage = {
  id: string;
  eventId: string | null;
  eventTitle: string | null;
  publisherName: string | null;
  kind: string;
  audience: string;
  audienceTagName?: string | null;
  status: string;
  sendAt: string | null;
  createdAt: string;
};

export function PushMessagesPanel() {
  const t = useTranslations('PushMessages');
  const list = useQuery({
    queryKey: ['admin-push-messages'],
    queryFn: () => adminFetch<{ items: PushMessage[] }>('/push-messages'),
  });

  function audienceLabel(row: PushMessage): string {
    if (row.audience === 'area') return t('audienceArea');
    if (row.audience === 'area_and_tag') return t('audienceAreaAndTag');
    if (row.kind === 'broadcast') {
      if (row.audience === 'tag_interest') {
        return t('audienceTagLabel', { tag: row.audienceTagName ?? '—' });
      }
      return t('audienceEveryone');
    }
    return t('audienceEventMatch');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/push-messages/event" className={buttonVariants({ variant: 'outline' })}>
            {t('composeEvent')}
          </Link>
          <Link href="/push-messages/broadcast" className={buttonVariants()}>
            {t('composeBroadcast')}
          </Link>
        </div>
      </div>
      {list.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('loadError')}</AlertDescription>
        </Alert>
      ) : null}
      {list.isLoading ? <LoadingRows /> : null}
      {list.data?.items.length === 0 ? <EmptyState icon={BellIcon} title={t('empty')} /> : null}
      {(list.data?.items.length ?? 0) > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead>{t('colKind')}</TableHead>
                <TableHead>{t('colTarget')}</TableHead>
                <TableHead>{t('colAudience')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>{t('colSendAt')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Badge variant="secondary">
                      {row.kind === 'broadcast' ? t('kindBroadcast') : t('kindEvent')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {row.kind === 'broadcast' ? t('broadcastTarget') : (row.eventTitle ?? '—')}
                    {row.publisherName ? (
                      <span className="block text-xs text-muted-foreground">
                        {row.publisherName}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{audienceLabel(row)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.sendAt ? new Date(row.sendAt).toLocaleString() : t('asap')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/push-messages/${row.id}`}
                      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    >
                      {t('edit')}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => void list.refetch()} disabled={list.isFetching}>
          {list.isFetching ? <Spinner data-icon="inline-start" /> : null}
          {t('refresh')}
        </Button>
      </div>
    </div>
  );
}
