import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LoginForm } from './login-form';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
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
        <h1 className="text-2xl font-semibold">{t('loginTitle')}</h1>
      </div>
      <LoginForm />
    </main>
  );
}
