'use client';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

type PublisherEvent = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  venueName: string | null;
};

export function PublisherEvents({ publisherId }: { publisherId: string }) {
  const t = useTranslations('PublisherEditor');

  const events = useQuery({
    queryKey: ['admin-publisher-events', publisherId],
    queryFn: () =>
      adminFetch<{ items: PublisherEvent[]; total: number }>(`/publishers/${publisherId}/events`),
    retry: false,
  });

  const items = events.data?.items ?? [];
  const total = events.data?.total ?? 0;

  return (
    <Stack spacing={1.5}>
      <Typography variant="h6" component="h2">
        {t('events')}
      </Typography>
      {events.isError ? <Alert severity="error">{t('eventsLoadError')}</Alert> : null}
      {events.isLoading ? <Typography color="text.secondary">{t('eventsLoading')}</Typography> : null}
      {events.data && items.length === 0 ? (
        <Typography color="text.secondary">{t('eventsEmpty')}</Typography>
      ) : null}
      {items.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('colId')}</TableCell>
              <TableCell>{t('colTitle')}</TableCell>
              <TableCell>{t('colStatus')}</TableCell>
              <TableCell>{t('colStarts')}</TableCell>
              <TableCell>{t('colVenue')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{item.id}</TableCell>
                <TableCell>
                  <Link href={`/events/${item.id}`}>{item.title}</Link>
                </TableCell>
                <TableCell>{item.status}</TableCell>
                <TableCell>{new Date(item.startsAt).toLocaleString()}</TableCell>
                <TableCell>{item.venueName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {events.data && total > items.length ? (
        <Typography variant="body2" color="text.secondary">
          {t('eventsShowing', { shown: items.length, total })}
        </Typography>
      ) : null}
    </Stack>
  );
}
