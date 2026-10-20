'use client';

import { useQuery } from '@tanstack/react-query';
import { ScrollTextIcon } from 'lucide-react';
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
import { AdminApiError, adminFetch } from '@/lib/api';

type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  at: string;
};

export function AuditLogPanel() {
  const t = useTranslations('AuditLog');
  const tApp = useTranslations('App');
  const list = useQuery({
    queryKey: ['admin-audit-log'],
    queryFn: () => adminFetch<{ items: AuditEntry[] }>('/audit-log'),
    retry: false,
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {list.isLoading ? <LoadingRows /> : null}
      {!list.isLoading && items.length === 0 ? (
        <EmptyState icon={ScrollTextIcon} title={t('empty')} />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead>{t('at')}</TableHead>
                <TableHead>{t('actor')}</TableHead>
                <TableHead>{t('action')}</TableHead>
                <TableHead>{t('entity')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{new Date(item.at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{item.actor}</TableCell>
                  <TableCell>{item.action}</TableCell>
                  <TableCell>
                    {item.entityType}{' '}
                    <span className="text-xs text-muted-foreground">{item.entityId}</span>
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
