'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlagIcon, MapPinIcon, StarIcon, UsersIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState, LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    mutationFn: (id: string) => adminFetch(`/moderation/ratings/${id}/hide`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-moderation-ratings'] });
    },
  });

  const unauthorized =
    (users.error instanceof AdminApiError && users.error.status === 401) ||
    (ratings.error instanceof AdminApiError && ratings.error.status === 401);

  if (unauthorized) {
    return (
      <Alert>
        <AlertDescription>
          {t('needLogin')}{' '}
          <Link href="/login" className="underline underline-offset-4">
            {tApp('navLogin')}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (users.isError || ratings.isError || checkIns.isError || eventReports.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('loadError')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t('usersTitle')}</h2>
        {users.isLoading ? <LoadingRows /> : null}
        {(users.data?.items ?? []).length === 0 && !users.isLoading ? (
          <EmptyState icon={UsersIcon} title={t('usersEmpty')} />
        ) : null}
        {(users.data?.items ?? []).length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="rounded-t-lg border-b bg-muted">
                <TableRow>
                  <TableHead>{t('user')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users.data?.items ?? []).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      {u.displayName ?? u.recoveryEmail ?? u.id}
                      {u.banReason ? (
                        <span className="block text-xs text-muted-foreground">{u.banReason}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{u.bannedAt ? t('banned') : t('active')}</TableCell>
                    <TableCell className="text-right">
                      {u.bannedAt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => unban.mutate(u.id)}
                          disabled={unban.isPending}
                        >
                          {unban.isPending ? <Spinner data-icon="inline-start" /> : null}
                          {t('unban')}
                        </Button>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Input
                            className="min-w-40"
                            placeholder={t('banReason')}
                            value={banReason[u.id] ?? ''}
                            onChange={(event) =>
                              setBanReason((prev) => ({ ...prev, [u.id]: event.target.value }))
                            }
                          />
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={!banReason[u.id]?.trim() || ban.isPending}
                            onClick={() =>
                              ban.mutate({ id: u.id, reason: banReason[u.id]!.trim() })
                            }
                          >
                            {ban.isPending ? <Spinner data-icon="inline-start" /> : null}
                            {t('ban')}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t('ratingsTitle')}</h2>
        {(ratings.data?.items ?? []).length === 0 && !ratings.isLoading ? (
          <EmptyState icon={StarIcon} title={t('ratingsEmpty')} />
        ) : null}
        {(ratings.data?.items ?? []).length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="rounded-t-lg border-b bg-muted">
                <TableRow>
                  <TableHead>{t('event')}</TableHead>
                  <TableHead>{t('score')}</TableHead>
                  <TableHead>{t('comment')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ratings.data?.items ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.eventTitle}</TableCell>
                    <TableCell>{r.score}</TableCell>
                    <TableCell className="whitespace-normal">{r.comment ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {r.hiddenAt ? (
                        t('hidden')
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={hideRating.isPending}
                          onClick={() => hideRating.mutate(r.id)}
                        >
                          {hideRating.isPending ? <Spinner data-icon="inline-start" /> : null}
                          {t('hide')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t('reportsTitle')}</h2>
        {(eventReports.data?.items ?? []).length === 0 && !eventReports.isLoading ? (
          <EmptyState icon={FlagIcon} title={t('reportsEmpty')} />
        ) : null}
        {(eventReports.data?.items ?? []).length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="rounded-t-lg border-b bg-muted">
                <TableRow>
                  <TableHead>{t('event')}</TableHead>
                  <TableHead>{t('at')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(eventReports.data?.items ?? []).map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>{report.eventTitle}</TableCell>
                    <TableCell>{new Date(report.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t('checkInsTitle')}</h2>
        {(checkIns.data?.items ?? []).length === 0 && !checkIns.isLoading ? (
          <EmptyState icon={MapPinIcon} title={t('checkInsEmpty')} />
        ) : null}
        {(checkIns.data?.items ?? []).length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="rounded-t-lg border-b bg-muted">
                <TableRow>
                  <TableHead>{t('event')}</TableHead>
                  <TableHead>{t('method')}</TableHead>
                  <TableHead>{t('accuracy')}</TableHead>
                  <TableHead>{t('at')}</TableHead>
                </TableRow>
              </TableHeader>
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
