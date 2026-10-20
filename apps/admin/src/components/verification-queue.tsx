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
  origin: string;
  eventCount: number;
  createdAt: string;
};

export function VerificationQueue({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('Publishers');
  const tApp = useTranslations('App');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState(false);

  const me = useQuery({
    queryKey: ['admin-me'],
    queryFn: () => adminFetch<{ email: string }>('/admin/me'),
    retry: false,
  });

  const list = useQuery({
    queryKey: ['admin-publishers-unverified'],
    queryFn: async () => {
      const body = await adminFetch<{ items: PublisherRow[] }>('/publishers?status=in_review');
      return body.items;
    },
    enabled: Boolean(me.data),
    retry: false,
  });

  const verify = useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ releasedEventCount: number }>(`/publishers/${id}/verify`, {
        method: 'POST',
      }),
    onSuccess: async (result) => {
      setNotice(t('verifiedNotice', { count: result.releasedEventCount }));
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
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
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
    },
  });

  const Title = embedded ? 'h2' : 'h1';

  if (me.isPending) {
    return <LoadingRows />;
  }

  if (me.isError || !me.data) {
    return (
      <div className="flex flex-col gap-4">
        <Title className={embedded ? 'text-xl font-semibold' : 'text-2xl font-semibold'}>
          {t('title')}
        </Title>
        <Alert>
          <AlertDescription>
            {t('needLogin')}{' '}
            <Link href="/login" className="underline underline-offset-4">
              {tApp('navLogin')}
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const items = [...(list.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, locale, { sensitivity: 'base' }),
  );
  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id));
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Title className={embedded ? 'text-xl font-semibold' : 'text-2xl font-semibold'}>
          {t('title')}
        </Title>
        {items.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('selected', { count: selectedIds.length })}
              </p>
            ) : null}
            <Button
              size="sm"
              disabled={selectedIds.length === 0 || busy}
              onClick={() => {
                setNotice(null);
                setBulkError(false);
                bulkVerify.mutate(selectedIds);
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
      {list.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {list.error instanceof AdminApiError ? list.error.message : t('loadError')}
          </AlertDescription>
        </Alert>
      ) : null}
      {list.isPending ? (
        <LoadingRows />
      ) : list.data && list.data.length === 0 ? (
        <EmptyState icon={UsersIcon} title={t('empty')} />
      ) : (
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
                <TableHead>{t('events')}</TableHead>
                <TableHead>{t('slug')}</TableHead>
                <TableHead>{t('type')}</TableHead>
                <TableHead>{t('origin')}</TableHead>
                <TableHead>{t('created')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleOne(row.id)}
                      aria-label={t('selectRow', { name: row.name })}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/publishers/${row.id}`} className="underline underline-offset-4">
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.id}</TableCell>
                  <TableCell>{row.eventCount}</TableCell>
                  <TableCell>{row.slug}</TableCell>
                  <TableCell>{row.type}</TableCell>
                  <TableCell>{row.origin}</TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/publishers/${row.id}`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        {t('edit')}
                      </Link>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setNotice(null);
                          verify.mutate(row.id);
                        }}
                      >
                        {busy ? <Spinner data-icon="inline-start" /> : null}
                        {busy ? t('verifying') : t('verify')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
