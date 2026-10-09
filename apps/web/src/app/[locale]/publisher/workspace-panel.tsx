'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';
import { QueryProvider } from '@/lib/query-provider';
import { LogoutButton } from './logout-button';

function WorkspaceInner() {
  const t = useTranslations('Publisher');
  const me = useQuery({
    queryKey: ['publisher-me'],
    queryFn: async () => throwIfError(await api.GET('/v1/publishers/me')),
    retry: false,
  });

  if (me.isPending) {
    return <p className="text-sm text-zinc-500">…</p>;
  }

  if (me.isError || !me.data) {
    return (
      <div className="space-y-3">
        <p className="text-zinc-600">{t('errorCredentials')}</p>
        <Link href="/publisher/login" className="underline underline-offset-4">
          {t('loginTitle')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-zinc-600">{t('welcome', { email: me.data.email })}</p>
        <LogoutButton />
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          {t('yourPublishers')}
        </h2>
        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
          {me.data.publishers.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-zinc-500">
                {p.slug} · {p.role}
              </span>
            </li>
          ))}
        </ul>
      </section>
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
