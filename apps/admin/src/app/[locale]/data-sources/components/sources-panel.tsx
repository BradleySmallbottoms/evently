'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseIcon, HistoryIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
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

type DataSource = {
  id: string;
  slug: string;
  kind: string;
  schedule: string;
  trust: string;
  enabled: boolean;
};

type Run = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  error: string | null;
};

export function SourcesPanel() {
  const t = useTranslations('DataSources');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin-data-sources'],
    queryFn: () => adminFetch<{ items: DataSource[] }>('/data-sources'),
    retry: false,
  });

  const runs = useQuery({
    queryKey: ['admin-data-source-runs', selectedId],
    queryFn: () => adminFetch<{ items: Run[] }>(`/data-sources/${selectedId}/runs`),
    enabled: !!selectedId,
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) =>
      adminFetch(`/data-sources/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: input.enabled }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-data-sources'] });
    },
  });

  const run = useMutation({
    mutationFn: async (id: string) =>
      adminFetch<{ started: boolean; message: string }>(`/data-sources/${id}/run`, {
        method: 'POST',
      }),
    onSuccess: async (body, id) => {
      setSelectedId(id);
      setRunMessage(body.message);
      await queryClient.invalidateQueries({ queryKey: ['admin-data-source-runs'] });
    },
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
      {runMessage ? (
        <Alert>
          <AlertDescription>{runMessage}</AlertDescription>
        </Alert>
      ) : null}
      {run.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {run.error instanceof AdminApiError ? run.error.message : t('runError')}
          </AlertDescription>
        </Alert>
      ) : null}
      {list.isLoading ? <LoadingRows /> : null}
      {!list.isLoading && items.length === 0 ? (
        <EmptyState icon={DatabaseIcon} title={t('empty')} />
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="rounded-t-lg border-b bg-muted">
              <TableRow>
                <TableHead>{t('slug')}</TableHead>
                <TableHead>{t('kind')}</TableHead>
                <TableHead>{t('schedule')}</TableHead>
                <TableHead>{t('trust')}</TableHead>
                <TableHead>{t('enabled')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  data-state={selectedId === item.id ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(item.id)}
                >
                  <TableCell>{item.slug}</TableCell>
                  <TableCell>{item.kind}</TableCell>
                  <TableCell>{item.schedule}</TableCell>
                  <TableCell>{item.trust}</TableCell>
                  <TableCell
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <Switch
                      checked={item.enabled}
                      disabled={toggle.isPending}
                      aria-label={t('enabled')}
                      onCheckedChange={(enabled) => toggle.mutate({ id: item.id, enabled })}
                    />
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(item.id)}>
                      {run.isPending ? <Spinner data-icon="inline-start" /> : null}
                      {t('run')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {selectedId ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">{t('runsTitle')}</h2>
          {runs.isLoading ? <LoadingRows /> : null}
          {(runs.data?.items.length ?? 0) === 0 && !runs.isLoading ? (
            <EmptyState icon={HistoryIcon} title={t('runsEmpty')} />
          ) : null}
          {(runs.data?.items.length ?? 0) > 0 ? (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="rounded-t-lg border-b bg-muted">
                  <TableRow>
                    <TableHead>{t('started')}</TableHead>
                    <TableHead>{t('status')}</TableHead>
                    <TableHead>{t('fetched')}</TableHead>
                    <TableHead>{t('created')}</TableHead>
                    <TableHead>{t('updated')}</TableHead>
                    <TableHead>{t('skipped')}</TableHead>
                    <TableHead>{t('error')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runs.data?.items ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{new Date(row.startedAt).toLocaleString()}</TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell>{row.fetched}</TableCell>
                      <TableCell>{row.created}</TableCell>
                      <TableCell>{row.updated}</TableCell>
                      <TableCell>{row.skipped}</TableCell>
                      <TableCell>{row.error ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
