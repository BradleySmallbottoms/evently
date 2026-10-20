import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { VerifyForm } from './components/verify-form';

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

export default async function VerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Publisher');
  const nav = await getTranslations('Nav');

  return (
    <PageMain maxWidth="sm">
      <div className="flex flex-col gap-2">
        <AppLink href="/" className={backLinkClass}>
          {nav('home')}
        </AppLink>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {t('verifyTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('registerSuccess')}</p>
      </div>
      <Suspense fallback={null}>
        <VerifyForm />
      </Suspense>
    </PageMain>
  );
}
