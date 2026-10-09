'use client';

import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { AcceptInviteForm } from './components/accept-invite-form';

export default function AcceptInvitePage() {
  const t = useTranslations('Publisher');
  const nav = useTranslations('Nav');

  return (
    <PageMain maxWidth="sm">
      <Stack spacing={1}>
        <Link
          component={AppLink}
          href="/publisher"
          underline="hover"
          variant="body2"
          color="text.secondary"
        >
          {nav('workspace')}
        </Link>
        <Typography variant="h4" component="h1">
          {t('acceptInviteTitle')}
        </Typography>
        <Typography color="text.secondary">{t('acceptInviteHint')}</Typography>
      </Stack>
      <QueryProvider>
        <Suspense
          fallback={
            <Typography variant="body2" color="text.secondary">
              …
            </Typography>
          }
        >
          <AcceptInviteForm />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}