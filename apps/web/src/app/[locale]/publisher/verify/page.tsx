import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { Link } from '@/i18n/navigation';
import { VerifyForm } from './verify-form';

export default async function VerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Publisher');
  const nav = await getTranslations('Nav');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-16">
      <div className="space-y-2">
        <Link href="/" className="text-sm text-zinc-500 underline underline-offset-4">
          {nav('home')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('verifyTitle')}</h1>
        <p className="text-sm text-zinc-600">{t('registerSuccess')}</p>
      </div>
      <Suspense fallback={null}>
        <VerifyForm />
      </Suspense>
    </main>
  );
}
