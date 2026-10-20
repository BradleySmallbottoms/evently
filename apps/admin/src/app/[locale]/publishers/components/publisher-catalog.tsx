'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { AdminApiError, adminFetch } from '@/lib/api';

type PublisherRow = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: 'pending_scan' | 'in_review' | 'published';
  origin: string;
  createdAt: string;
};

function statusLabel(
  t: (key: 'statusPendingScan' | 'statusInReview' | 'statusPublished') => string,
  status: PublisherRow['status'],
): string {
  if (status === 'pending_scan') return t('statusPendingScan');
  if (status === 'in_review') return t('statusInReview');
  return t('statusPublished');
}

export function PublisherCatalog() {
  const t = useTranslations('PublisherCatalog');
  const tApp = useTranslations('App');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin-publishers-all'],
    queryFn: () => adminFetch<{ items: PublisherRow[] }>('/publishers?all=true'),
    retry: false,
  });

  const verify = useMutation({
    mutationFn: (id: string) => adminFetch(`/publishers/${id}/verify`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
    },
  });

  const bulkVerify = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          adminFetch<{ releasedEventCount: number }>(`/publishers/${id}/verify`, {
            method: 'POST',
          }),
        ),
      );
      const failedIds = ids.filter((_, index) => results[index]?.status === 'rejected');
      const released = results.reduce(
        (sum, result) =>
          result.status === 'fulfilled' ? sum + result.value.releasedEventCount : sum,
        0,
      );
      return { failedIds, released };
    },
    onSuccess: async ({ failedIds, released }) => {
      setSelected(new Set(failedIds));
      setBulkError(failedIds.length > 0);
      setNotice(failedIds.length === 0 ? t('verifiedNotice', { count: released }) : null);
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
    },
  });

  const items = [...(list.data?.items ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, locale, { sensitivity: 'base' }),
  );
  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id));
  const canVerify = items.some((item) => selected.has(item.id) && item.status !== 'published');
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const busy = verify.isPending || bulkVerify.isPending;

  function toggleAll() {
    setBulkError(false);
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  }

  function toggleOne(id: string) {
    setBulkError(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (list.isError) {
    const unauthorized = list.error instanceof AdminApiError && list.error.status === 401;
    return (
      <Alert variant={unauthorized ? 'default' : 'destructive'}>
        <AlertDescription>
          {unauthorized ? (
            <>
              {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
            </>
          ) : (
            t('loadError')
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        {items.length > 0 ? (
          <div className="flex flex-row flex-wrap items-center gap-2">
            {selectedIds.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('selected', { count: selectedIds.length })}
              </p>
            ) : null}
            <Button
              size="sm"
              disabled={!canVerify || busy}
              onClick={() => {
                setNotice(null);
                setBulkError(false);
                bulkVerify.mutate(
                  items
                    .filter((item) => selected.has(item.id) && item.status !== 'published')
                    .map((item) => item.id),
                );
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {t('verify')}
            </Button>
          </div>
        ) : null}
      </div>
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {bulkError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('bulkError')}</AlertDescription>
        </Alert>
      ) : null}
      {list.isLoading ? <LoadingRows /> : null}
      {!list.isLoading && items.length === 0 ? (
        <EmptyState icon={UsersIcon} title={t('empty')} />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={() => toggleAll()}
                    aria-label={t('selectAll')}
                  />
                </TableHead>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('id')}</TableHead>
                <TableHead>{t('slug')}</TableHead>
                <TableHead>{t('origin')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} data-state={selected.has(item.id) ? 'selected' : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={() => toggleOne(item.id)}
                      aria-label={t('selectRow', { name: item.name })}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/publishers/${item.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {item.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.id}</TableCell>
                  <TableCell>{item.slug}</TableCell>
                  <TableCell>{item.origin}</TableCell>
                  <TableCell>{statusLabel(t, item.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/publishers/${item.id}`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        {t('edit')}
                      </Link>
                      {item.status !== 'published' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => verify.mutate(item.id)}
                        >
                          {busy ? <Spinner data-icon="inline-start" /> : null}
                          {t('verify')}
                        </Button>
                      ) : null}
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
