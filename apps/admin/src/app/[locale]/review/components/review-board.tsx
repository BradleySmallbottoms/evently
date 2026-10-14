'use client';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { VerificationQueue } from '@/components/verification-queue';
import { Link } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';
import { PendingNotifications } from './pending-notifications';
import { ReviewQueue } from './review-queue';

export function ReviewBoard() {
  const t = useTranslations('Review');
  const tApp = useTranslations('App');
  const me = useQuery({
    queryKey: ['admin-me'],
    queryFn: () => adminFetch<{ email: string }>('/admin/me'),
    retry: false,
  });

  if (me.isPending) {
    return <Typography color="text.secondary">{tApp('loading')}</Typography>;
  }

  if (me.isError || !me.data) {
    return (
      <Stack spacing={2}>
        <Typography variant="h4" component="h1">
          {t('title')}
        </Typography>
        <Alert severity="info">
          {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <Typography variant="h4" component="h1">
          {t('title')}
        </Typography>
        <Typography color="text.secondary">{t('lead')}</Typography>
      </Stack>
      <ReviewQueue embedded />
      <VerificationQueue embedded />
      <PendingNotifications />
    </Stack>
  );
}
