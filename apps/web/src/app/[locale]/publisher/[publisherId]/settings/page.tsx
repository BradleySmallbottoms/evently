'use client';

import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { PublisherSettingsPanel } from './components/publisher-settings-panel';

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

export default function PublisherSettingsPage() {
  const t = useTranslations('Publisher');
  const nav = useTranslations('Nav');
  const params = useParams<{ publisherId: string }>();

  return (
    <PageMain maxWidth="sm">
      <div className="flex flex-col gap-2">
        <AppLink href="/publisher" className={backLinkClass}>
          {nav('workspace')}
        </AppLink>
        <AppLink href={`/publisher/${params.publisherId}/events`} className={backLinkClass}>
          {t('manageEvents')}
        </AppLink>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {t('settingsTitle')}
        </h1>
      </div>
      <QueryProvider>
        <PublisherSettingsPanel />
      </QueryProvider>
    </PageMain>
  );
}
