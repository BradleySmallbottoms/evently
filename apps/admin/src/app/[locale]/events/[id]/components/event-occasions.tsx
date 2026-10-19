'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
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
import { adminFetch } from '@/lib/api';

type Occasion = {
  startsAt: string;
  endsAt?: string;
  venueName?: string;
};

type GroupItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
};

export function EventOccasions({
  eventId,
  occasions,
  occasionGroupId,
  onCollapsed,
}: {
  eventId: string;
  occasions: Occasion[] | undefined;
  occasionGroupId: string | undefined;
  onCollapsed: () => void;
}) {
  const t = useTranslations('EventEditor');
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const stored = occasions ?? [];

  const group = useQuery({
    queryKey: ['admin-event-occasion-group', eventId, occasionGroupId],
    queryFn: () => adminFetch<{ items: GroupItem[] }>(`/events/${eventId}/occasion-group`),
    enabled: Boolean(occasionGroupId),
    retry: false,
  });

  const collapse = useMutation({
    mutationFn: (eventIds: string[]) =>
      adminFetch(`/events/${eventId}/collapse`, {
        method: 'POST',
        body: JSON.stringify({ eventIds }),
      }),
    onSuccess: async () => {
      setSelected(new Set());
      setError(false);
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ['admin-event', eventId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-event-occasion-group', eventId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      onCollapsed();
    },
    onError: () => setError(true),
  });

  const items = group.data?.items ?? [];

  function toggle(id: string) {
    setError(false);
    setDone(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Stack spacing={3}>
      {done ? <Alert severity="success">{t('collapsed')}</Alert> : null}
      {stored.length > 0 ? (
        <Stack spacing={1}>
          <Typography variant="h6" component="h2">
            {t('occasionsTitle')}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('startsAt')}</TableCell>
                <TableCell>{t('endsAt')}</TableCell>
                <TableCell>{t('venueName')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stored.map((occasion) => (
                <TableRow key={`${occasion.startsAt}-${occasion.endsAt ?? ''}`}>
                  <TableCell>{new Date(occasion.startsAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {occasion.endsAt ? new Date(occasion.endsAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>{occasion.venueName ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      ) : null}
      {occasionGroupId ? (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              variant="contained"
              size="small"
              disabled={selected.size === 0 || collapse.isPending}
              onClick={() => collapse.mutate([...selected])}
            >
              {t('collapse')}
            </Button>
          </Stack>
          {error ? <Alert severity="error">{t('collapseError')}</Alert> : null}
          {group.isLoading ? (
            <Typography color="text.secondary">{t('groupLoading')}</Typography>
          ) : null}
          {group.isError ? <Alert severity="error">{t('collapseError')}</Alert> : null}
          {!group.isLoading && items.length === 0 ? (
            <Typography color="text.secondary">{t('groupEmpty')}</Typography>
          ) : null}
          {items.length > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>{t('name')}</TableCell>
                  <TableCell>{t('startsAt')}</TableCell>
                  <TableCell>{t('endsAt')}</TableCell>
                  <TableCell>{t('venueName')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => {
                  const current = item.id === eventId;
                  return (
                    <TableRow
                      key={item.id}
                      selected={selected.has(item.id)}
                      sx={
                        current
                          ? { '& .MuiTableCell-root': { color: 'text.disabled' } }
                          : undefined
                      }
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={current ? false : selected.has(item.id)}
                          disabled={current}
                          onChange={() => toggle(item.id)}
                          slotProps={{
                            input: {
                              'aria-label': current
                                ? t('currentOccasion')
                                : t('selectOccasion', { title: item.title }),
                            },
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {current ? item.title : <Link href={`/events/${item.id}`}>{item.title}</Link>}
                      </TableCell>
                      <TableCell>{new Date(item.startsAt).toLocaleString()}</TableCell>
                      <TableCell>{new Date(item.endsAt).toLocaleString()}</TableCell>
                      <TableCell>{item.venueName ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
