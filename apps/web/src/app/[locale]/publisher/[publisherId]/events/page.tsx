'use client';

import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { api, throwIfError } from '@/lib/api';
import { QueryProvider } from '@/lib/query-provider';

const styles: Record<string, SxProps<Theme>> = {
  list: {
    listStyle: 'none',
    m: 0,
    p: 0,
  },
  header: {
    flexDirection: { xs: 'column', sm: 'row' },
    alignItems: { xs: 'stretch', sm: 'center' },
    justifyContent: 'space-between',
    gap: 2,
  },
};

function statusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'published') return 'success';
  if (status === 'awaiting_verification') return 'warning';
  if (status === 'cancelled') return 'error';
  return 'default';
}

function PublisherEventsInner() {
  const t = useTranslations('Events');
  const { publisherId } = useParams<{ publisherId: string }>();
  const list = useQuery({
    queryKey: ['publisher-events', publisherId],
    queryFn: async () =>
      throwIfError(
        await api.GET('/publishers/{publisherId}/events', {
          params: { path: { publisherId } },
        }),
      ),
    retry: false,
  });

  if (list.isPending) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('loading')}
      </Typography>
    );
  }
  if (list.isError) {
    return (
      <Typography variant="body2" color="error">
        {t('loadError')}
      </Typography>
    );
  }

  return (
    <Stack spacing={3}>
      <Stack sx={styles.header}>
        <Typography variant="h4" component="h1">
          {t('publisherEventsTitle')}
        </Typography>
        <Button
          component={AppLink}
          href={`/publisher/${publisherId}/events/new`}
          variant="contained"
        >
          {t('newEvent')}
        </Button>
      </Stack>

      {list.data.items.length === 0 ? (
        <Typography color="text.secondary">{t('noEvents')}</Typography>
      ) : (
        <Stack spacing={1.5} component="ul" sx={styles.list}>
          {list.data.items.map((event) => (
            <Card key={event.id} component="li" variant="outlined">
              <CardContent>
                <Stack
                  direction="row"
                  spacing={2}
                  useFlexGap
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                  }}
                >
                  <Stack spacing={0.5}>
                    <Typography variant="h6" component="h2">
                      {event.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(event.startsAt).toLocaleString()} -{' '}
                      {new Date(event.endsAt).toLocaleString()}
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label={t(`status.${event.status}`)}
                    color={statusColor(event.status)}
                  />
                </Stack>
              </CardContent>
              <CardActions>
                <Button
                  component={AppLink}
                  href={`/publisher/${publisherId}/events/${event.id}`}
                  size="small"
                >
                  {t('editEvent')}
                </Button>
              </CardActions>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export default function PublisherEventsPage() {
  const t = useTranslations('Nav');
  return (
    <PageMain>
      <Link
        component={AppLink}
        href="/publisher"
        underline="hover"
        variant="body2"
        color="text.secondary"
      >
        {t('workspace')}
      </Link>
      <QueryProvider>
        <Suspense
          fallback={
            <Typography variant="body2" color="text.secondary">
              …
            </Typography>
          }
        >
          <PublisherEventsInner />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
