'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { AcceptInviteForm } from './components/accept-invite-form';

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

export default function AcceptInvitePage() {
  const t = useTranslations('Publisher');
  const nav = useTranslations('Nav');

  return (
    <PageMain maxWidth="sm">
      <div className="flex flex-col gap-2">
        <AppLink href="/publisher" className={backLinkClass}>
          {nav('workspace')}
        </AppLink>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {t('acceptInviteTitle')}
        </h1>
        <p className="text-muted-foreground">{t('acceptInviteHint')}</p>
      </div>
      <QueryProvider>
        <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
          <AcceptInviteForm />
        </Suspense>
      </QueryProvider>
    </PageMain>
  );
}
