import { Suspense } from 'react';
import { PublisherSettingsPage } from './components/publisher-settings-page';

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
      <PublisherSettingsPage />
    </Suspense>
  );
}
