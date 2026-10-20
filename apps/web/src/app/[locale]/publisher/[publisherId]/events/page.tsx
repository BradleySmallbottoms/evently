'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { PublisherEventsList } from './components/publisher-events-list';

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

export default function PublisherEventsPage() {
  const t = useTranslations('Nav');
  return (
    <PageMain>
      <AppLink href="/publisher" className={backLinkClass}>
        {t('workspace')}
      </AppLink>
      <QueryProvider>
        <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
          <PublisherEventsList />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
