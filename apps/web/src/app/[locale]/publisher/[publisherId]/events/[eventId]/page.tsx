'use client';

import { Suspense } from 'react';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { EditEventForm } from '../components/edit-event-form';

export default function PublisherEventDetailPage() {
  return (
    <PageMain>
      <QueryProvider>
        <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
          <EditEventForm />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
