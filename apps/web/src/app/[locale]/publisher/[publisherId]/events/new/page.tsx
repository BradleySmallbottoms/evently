'use client';

import Typography from '@mui/material/Typography';
import { Suspense } from 'react';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { NewEventForm } from '../components/new-event-form';

export default function NewPublisherEventPage() {
  return (
    <PageMain>
      <QueryProvider>
        <Suspense
          fallback={
            <Typography variant="body2" color="text.secondary">
              …
            </Typography>
          }
        >
          <NewEventForm />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
