import Typography from '@mui/material/Typography';
import { Suspense } from 'react';
import { PageMain } from '@/components/page-main';
import { PublicEventDetail } from './components/public-event-detail';

export default function PublicEventDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  return (
    <PageMain>
      <Suspense
        fallback={
          <Typography variant="body2" color="text.secondary">
            …
          </Typography>
        }
      >
        <PublicEventDetail params={params} />
      </Suspense>
    </PageMain>
  );
}
