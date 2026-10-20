import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { LoginWithCodeForm } from './components/login-with-code-form';

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

export default async function LoginWithCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { locale } = await params;
  const { code } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('Pairing');
  const nav = await getTranslations('Nav');

  return (
    <PageMain maxWidth="sm">
      <div className="flex flex-col gap-2">
        <AppLink href="/" className={backLinkClass}>
          {nav('home')}
        </AppLink>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <LoginWithCodeForm initialCode={code} />
    </PageMain>
  );
}
