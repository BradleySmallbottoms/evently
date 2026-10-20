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
      <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
        <PublicEventDetail params={params} />
      </Suspense>
    </PageMain>
  );
}
