'use client';

import Button from '@mui/material/Button';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';

export function LogoutButton() {
  const t = useTranslations('Publisher');
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="outlined"
      size="small"
      onClick={async () => {
        await api.POST('/publishers/logout');
        router.push('/publisher/login');
      }}
    >
      {t('logout')}
    </Button>
  );
}
