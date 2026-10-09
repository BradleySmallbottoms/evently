import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('App');
  const nav = await getTranslations('Nav');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">{t('name')}</h1>
        <p className="text-lg text-zinc-600">{t('tagline')}</p>
      </div>
      <nav className="flex flex-wrap gap-4 text-sm font-medium">
        <Link className="underline underline-offset-4" href="/publisher/login">
          {nav('publisherLogin')}
        </Link>
        <Link className="underline underline-offset-4" href="/publisher/register">
          {nav('publisherRegister')}
        </Link>
      </nav>
    </main>
  );
}
