'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AppLink } from '@/components/app-link';
import { api, throwIfError } from '@/lib/api';
import { QueryProvider } from '@/lib/query-provider';
import { LogoutButton } from './logout-button';

const linkClass = 'text-sm underline-offset-4 hover:underline';

function WorkspaceInner() {
  const t = useTranslations('Publisher');
  const me = useQuery({
    queryKey: ['publisher-me'],
    queryFn: async () => throwIfError(await api.GET('/publishers/me')),
    retry: false,
  });

  if (me.isPending) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (me.isError || !me.data) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground">{t('errorCredentials')}</p>
        <AppLink href="/publisher/login" className="underline-offset-4 hover:underline">
          {t('loginTitle')}
        </AppLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-row items-start justify-between gap-4">
        <p className="text-muted-foreground">{t('welcome', { email: me.data.email })}</p>
        <LogoutButton />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('yourPublishers')}
        </p>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          {me.data.publishers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-base text-foreground">{p.name}</p>
                <p className="text-sm text-muted-foreground">
                  {p.slug} · {p.role}
                </p>
              </div>
              <div className="flex flex-row items-center gap-3">
                <AppLink href={`/publisher/${p.id}/settings`} className={linkClass}>
                  {t('settingsLink')}
                </AppLink>
                <AppLink href={`/publisher/${p.id}/events`} className={linkClass}>
                  {t('manageEvents')}
                </AppLink>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function WorkspacePanel() {
  return (
    <QueryProvider>
      <WorkspaceInner />
    </QueryProvider>
  );
}
