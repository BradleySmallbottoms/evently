'use client';

import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { PublisherEventsList } from './components/publisher-events-list';

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
          <PublisherEventsList />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
