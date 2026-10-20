'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { LoadingRows } from '@/components/list-state';
import { VerificationQueue } from '@/components/verification-queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';
import { PendingNotifications } from './pending-notifications';
import { ReviewQueue } from './review-queue';

export function ReviewBoard() {
  const t = useTranslations('Review');
  const tApp = useTranslations('App');
  const me = useQuery({
    queryKey: ['admin-me'],
    queryFn: () => adminFetch<{ email: string }>('/admin/me'),
    retry: false,
  });

  if (me.isPending) {
    return <LoadingRows />;
  }

  if (me.isError || !me.data) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Alert>
          <AlertDescription>
            {t('needLogin')}{' '}
            <Link href="/login" className="underline underline-offset-4">
              {tApp('navLogin')}
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('lead')}</p>
      </div>
      <ReviewQueue embedded />
      <VerificationQueue embedded />
      <PendingNotifications />
    </div>
  );
}
