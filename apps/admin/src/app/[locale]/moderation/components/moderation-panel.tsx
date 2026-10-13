'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

type UserRow = {
  id: string;
  displayName: string | null;
  recoveryEmail: string | null;
  bannedAt: string | null;
  banReason: string | null;
  createdAt: string;
};

type RatingRow = {
  id: string;
  eventTitle: string;
  score: number;
  comment: string | null;
  hiddenAt: string | null;
  createdAt: string;
};

type CheckInRow = {
  id: string;
  userId: string;
  eventTitle: string;
  method: 'geo' | 'code';
  accuracyM: number | null;
  createdAt: string;
};

type EventReportRow = {
  id: string;
  eventTitle: string;
  createdAt: string;
};

export function ModerationPanel() {
  const t = useTranslations('Moderation');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [banReason, setBanReason] = useState<Record<string, string>>({});

  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminFetch<{ items: UserRow[] }>('/users'),
    retry: false,
  });
  const ratings = useQuery({
    queryKey: ['admin-moderation-ratings'],
    queryFn: () => adminFetch<{ items: RatingRow[] }>('/moderation/ratings'),
    retry: false,
  });
  const checkIns = useQuery({
    queryKey: ['admin-moderation-check-ins'],
    queryFn: () => adminFetch<{ items: CheckInRow[] }>('/moderation/check-ins'),
    retry: false,
  });
  const eventReports = useQuery({
    queryKey: ['admin-moderation-event-reports'],
    queryFn: () => adminFetch<{ items: EventReportRow[] }>('/moderation/event-reports'),
    retry: false,
  });

  const ban = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      adminFetch(`/users/${input.id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason: input.reason }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const unban = useMutation({
    mutationFn: (id: string) => adminFetch(`/users/${id}/unban`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const hideRating = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/moderation/ratings/${id}/hide`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-moderation-ratings'] });
    },
  });

  const unauthorized =
    (users.error instanceof AdminApiError && users.error.status === 401) ||
    (ratings.error instanceof AdminApiError && ratings.error.status === 401);

  if (unauthorized) {
    return (
      <Alert severity="info">
        {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
      </Alert>
    );
  }

  if (users.isError || ratings.isError || checkIns.isError || eventReports.isError) {
    return <Alert severity="error">{t('loadError')}</Alert>;
  }

  return (
    <Stack spacing={4}>
      <Typography variant="h4" component="h1">
        {t('title')}
      </Typography>

      <Stack spacing={2}>
        <Typography variant="h5" component="h2">
          {t('usersTitle')}
        </Typography>
        {users.isLoading ? (
          <Typography color="text.secondary">{tApp('loading')}</Typography>
        ) : null}
        {(users.data?.items ?? []).length === 0 && !users.isLoading ? (
          <Typography color="text.secondary">{t('usersEmpty')}</Typography>
        ) : null}
        {(users.data?.items ?? []).length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('user')}</TableCell>
                <TableCell>{t('status')}</TableCell>
                <TableCell align="right">{t('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(users.data?.items ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    {u.displayName ?? u.recoveryEmail ?? u.id}
                    {u.banReason ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        {u.banReason}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {u.bannedAt ? t('banned') : t('active')}
                  </TableCell>
                  <TableCell align="right">
                    {u.bannedAt ? (
                      <Button
                        size="small"
                        onClick={() => unban.mutate(u.id)}
                        disabled={unban.isPending}
                      >
                        {t('unban')}
                      </Button>
                    ) : (
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <TextField
                          size="small"
                          placeholder={t('banReason')}
                          value={banReason[u.id] ?? ''}
                          onChange={(e) =>
                            setBanReason((prev) => ({ ...prev, [u.id]: e.target.value }))
                          }
                          sx={{ minWidth: 160 }}
                        />
                        <Button
                          size="small"
                          color="error"
                          disabled={!(banReason[u.id]?.trim()) || ban.isPending}
                          onClick={() =>
                            ban.mutate({ id: u.id, reason: banReason[u.id]!.trim() })
                          }
                        >
                          {t('ban')}
                        </Button>
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Stack>

      <Stack spacing={2}>
        <Typography variant="h5" component="h2">
          {t('ratingsTitle')}
        </Typography>
        {(ratings.data?.items ?? []).length === 0 && !ratings.isLoading ? (
          <Typography color="text.secondary">{t('ratingsEmpty')}</Typography>
        ) : null}
        {(ratings.data?.items ?? []).length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('event')}</TableCell>
                <TableCell>{t('score')}</TableCell>
                <TableCell>{t('comment')}</TableCell>
                <TableCell align="right">{t('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(ratings.data?.items ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.eventTitle}</TableCell>
                  <TableCell>{r.score}</TableCell>
                  <TableCell>{r.comment ?? '—'}</TableCell>
                  <TableCell align="right">
                    {r.hiddenAt ? (
                      t('hidden')
                    ) : (
                      <Button
                        size="small"
                        color="warning"
                        disabled={hideRating.isPending}
                        onClick={() => hideRating.mutate(r.id)}
                      >
                        {t('hide')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Stack>

      <Stack spacing={2}>
        <Typography variant="h5" component="h2">
          {t('reportsTitle')}
        </Typography>
        {(eventReports.data?.items ?? []).length === 0 && !eventReports.isLoading ? (
          <Typography color="text.secondary">{t('reportsEmpty')}</Typography>
        ) : null}
        {(eventReports.data?.items ?? []).length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('event')}</TableCell>
                <TableCell>{t('at')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(eventReports.data?.items ?? []).map((report) => (
                <TableRow key={report.id}>
                  <TableCell>{report.eventTitle}</TableCell>
                  <TableCell>{new Date(report.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Stack>

      <Stack spacing={2}>
        <Typography variant="h5" component="h2">
          {t('checkInsTitle')}
        </Typography>
        {(checkIns.data?.items ?? []).length === 0 && !checkIns.isLoading ? (
          <Typography color="text.secondary">{t('checkInsEmpty')}</Typography>
        ) : null}
        {(checkIns.data?.items ?? []).length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('event')}</TableCell>
                <TableCell>{t('method')}</TableCell>
                <TableCell>{t('accuracy')}</TableCell>
                <TableCell>{t('at')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(checkIns.data?.items ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.eventTitle}</TableCell>
                  <TableCell>{c.method}</TableCell>
                  <TableCell>{c.accuracyM != null ? `${c.accuracyM} m` : '—'}</TableCell>
                  <TableCell>{new Date(c.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Stack>
    </Stack>
  );
}
