'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';

export function LogoutButton() {
  const t = useTranslations('Publisher');
  const router = useRouter();

  return (
    <button
      type="button"
      className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
      onClick={async () => {
        await api.POST('/v1/publishers/logout');
        router.push('/publisher/login');
      }}
    >
      {t('logout')}
    </button>
  );
}
