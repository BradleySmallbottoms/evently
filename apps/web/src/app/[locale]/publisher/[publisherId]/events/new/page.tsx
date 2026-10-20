'use client';

import { Suspense } from 'react';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { NewEventForm } from '../components/new-event-form';

export default function NewPublisherEventPage() {
  return (
    <PageMain>
      <QueryProvider>
        <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
          <NewEventForm />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
