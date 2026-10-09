'use client';

import Typography from '@mui/material/Typography';
import { Suspense } from 'react';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { EditEventForm } from '../components/edit-event-form';

export default function PublisherEventDetailPage() {
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
          <EditEventForm />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
