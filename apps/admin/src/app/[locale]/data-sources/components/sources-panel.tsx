'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
      <Alert severity={unauthorized ? 'info' : 'error'}>
        {unauthorized ? (
          <>
            {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
          </>
        ) : (
          t('loadError')
        )}
      </Alert>
    );
  }

  const items = list.data?.items ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        {t('title')}
      </Typography>
      {runMessage ? <Alert severity="info">{runMessage}</Alert> : null}
      {run.isError ? (
        <Alert severity="error">
          {run.error instanceof AdminApiError ? run.error.message : t('runError')}
        </Alert>
      ) : null}
      {list.isLoading ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {!list.isLoading && items.length === 0 ? (
        <Typography color="text.secondary">{t('empty')}</Typography>
      ) : null}
      {items.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('slug')}</TableCell>
              <TableCell>{t('kind')}</TableCell>
              <TableCell>{t('schedule')}</TableCell>
              <TableCell>{t('trust')}</TableCell>
              <TableCell>{t('enabled')}</TableCell>
              <TableCell align="right">{t('actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                hover
                selected={selectedId === item.id}
                onClick={() => setSelectedId(item.id)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{item.slug}</TableCell>
                <TableCell>{item.kind}</TableCell>
                <TableCell>{item.schedule}</TableCell>
                <TableCell>{item.trust}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={item.enabled}
                    disabled={toggle.isPending}
                    onChange={(_, enabled) => toggle.mutate({ id: item.id, enabled })}
                  />
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={run.isPending}
                    onClick={() => run.mutate(item.id)}
                  >
                    {t('run')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {selectedId ? (
        <Stack spacing={1}>
          <Typography variant="h6" component="h2">
            {t('runsTitle')}
          </Typography>
          {runs.isLoading ? (
            <Typography color="text.secondary">{tApp('loading')}</Typography>
          ) : null}
          {(runs.data?.items.length ?? 0) === 0 && !runs.isLoading ? (
            <Typography color="text.secondary">{t('runsEmpty')}</Typography>
          ) : null}
          {(runs.data?.items.length ?? 0) > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('started')}</TableCell>
                  <TableCell>{t('status')}</TableCell>
                  <TableCell>{t('fetched')}</TableCell>
                  <TableCell>{t('created')}</TableCell>
                  <TableCell>{t('updated')}</TableCell>
                  <TableCell>{t('skipped')}</TableCell>
                  <TableCell>{t('error')}</TableCell>
                </TableRow>
              </TableHead>
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
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
