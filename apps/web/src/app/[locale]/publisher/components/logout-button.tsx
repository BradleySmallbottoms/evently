'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';

export function LogoutButton() {
  const t = useTranslations('Publisher');
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await api.POST('/publishers/logout');
        router.push('/publisher/login');
      }}
    >
      {t('logout')}
    </Button>
  );
}
