'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
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
import { AdminApiError, adminFetch } from '@/lib/api';

type PendingPush = {
  id: string;
  eventId: string | null;
  eventTitle: string | null;
  publisherName: string | null;
  sendAt: string | null;
  titleSv: string;
  titleEn: string;
};

export function PendingNotifications() {
  const t = useTranslations('Review');
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['admin-push-messages', 'pending'],
    queryFn: () => adminFetch<{ items: PendingPush[] }>('/push-messages?status=pending'),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'reject' }) =>
      adminFetch(`/push-messages/${input.id}/${input.action}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages', 'pending'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
    },
  });

  if (list.isError) {
    const unauthorized = list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert variant={unauthorized ? 'default' : 'destructive'}>
        <AlertDescription>
          {unauthorized ? t('needLogin') : t('notificationsError')}
        </AlertDescription>
      </Alert>
    );
  }

  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('notificationsTitle')}</h2>
      {list.isLoading ? <LoadingRows /> : null}
      {!list.isLoading && items.length === 0 ? (
        <EmptyState icon={BellIcon} title={t('notificationsEmpty')} />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead>{t('notification')}</TableHead>
                <TableHead>{t('event')}</TableHead>
                <TableHead>{t('publisher')}</TableHead>
                <TableHead>{t('sendAt')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-normal">{item.titleSv}</TableCell>
                  <TableCell className="whitespace-normal">
                    {item.eventId ? (
                      <Link
                        href={`/events/${item.eventId}`}
                        className="underline underline-offset-4"
                      >
                        {item.eventTitle ?? item.eventId}
                      </Link>
                    ) : (
                      (item.eventTitle ?? '—')
                    )}
                  </TableCell>
                  <TableCell>{item.publisherName ?? '—'}</TableCell>
                  <TableCell>
                    {item.sendAt ? new Date(item.sendAt).toLocaleString() : t('asap')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-row justify-end gap-2">
                      <Link
                        href={`/push-messages/${item.id}`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        {t('view')}
                      </Link>
                      <Button
                        type="button"
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: item.id, action: 'approve' })}
                      >
                        {decide.isPending ? <Spinner data-icon="inline-start" /> : null}
                        {t('approve')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: item.id, action: 'reject' })}
                      >
                        {decide.isPending ? <Spinner data-icon="inline-start" /> : null}
                        {t('reject')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
