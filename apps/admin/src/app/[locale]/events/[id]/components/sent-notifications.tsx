'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

type SentNotification = {
  id: string;
  status: 'sending' | 'sent';
  audience: string;
  audienceTagName: string | null;
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
  sentAt: string | null;
  recipientCount: number;
};

function audienceLabel(
  row: SentNotification,
  t: ReturnType<typeof useTranslations<'EventEditor'>>,
): string {
  if (row.audience === 'area') return t('audienceArea');
  if (row.audience === 'area_and_tag') return t('audienceAreaAndTag');
  if (row.audience === 'everyone') return t('audienceEveryone');
  if (row.audience === 'tag_interest') {
    return t('audienceTag', { tag: row.audienceTagName ?? '—' });
  }
  return t('audienceEventMatch');
}

export function SentNotifications({ eventId }: { eventId: string }) {
  const t = useTranslations('EventEditor');
  const locale = useLocale();
  const list = useQuery({
    queryKey: ['admin-event-sent-notifications', eventId],
    queryFn: () =>
      adminFetch<{ items: SentNotification[] }>(`/events/${eventId}/sent-notifications`),
  });

  return (
    <Stack spacing={1}>
      <Typography variant="h6" component="h2">
        {t('sentNotifications')}
      </Typography>
      {list.isError ? <Alert severity="error">{t('sentNotificationsError')}</Alert> : null}
      {list.isLoading ? (
        <Typography color="text.secondary">{t('sentNotificationsLoading')}</Typography>
      ) : null}
      {list.data?.items.length === 0 ? (
        <Alert severity="info">{t('sentNotificationsEmpty')}</Alert>
      ) : null}
      {(list.data?.items.length ?? 0) > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('colSent')}</TableCell>
              <TableCell>{t('colMessage')}</TableCell>
              <TableCell>{t('colAudience')}</TableCell>
              <TableCell align="right">{t('colRecipients')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {list.data?.items.map((row) => {
              const title = locale === 'en' ? row.titleEn : row.titleSv;
              const body = locale === 'en' ? row.bodyEn : row.bodySv;
              return (
                <TableRow key={row.id} hover>
                  <TableCell>
                    {row.sentAt
                      ? new Date(row.sentAt).toLocaleString(locale)
                      : t('statusSending')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{title}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {body}
                    </Typography>
                  </TableCell>
                  <TableCell>{audienceLabel(row, t)}</TableCell>
                  <TableCell align="right">{row.recipientCount}</TableCell>
                  <TableCell align="right">
                    <Button component={Link} href={`/push-messages/${row.id}`} size="small">
                      {t('openNotification')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
    </Stack>
  );
}
