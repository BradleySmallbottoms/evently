import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('App');
  const nav = await getTranslations('Nav');

  return (
    <PageMain maxWidth="sm" className="justify-center">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('name')}</h1>
        <p className="text-lg font-normal text-muted-foreground">{t('tagline')}</p>
      </div>
      <div className="flex flex-row flex-wrap items-center gap-3">
        <AppLink href="/events" className={buttonVariants({ variant: 'brand' })}>
          {nav('events')}
        </AppLink>
        <AppLink href="/login-with-code" className={buttonVariants({ variant: 'outline' })}>
          {nav('loginWithCode')}
        </AppLink>
        <AppLink href="/publisher/login" className={buttonVariants({ variant: 'outline' })}>
          {nav('publisherLogin')}
        </AppLink>
        <AppLink href="/publisher/register" className={buttonVariants({ variant: 'ghost' })}>
          {nav('publisherRegister')}
        </AppLink>
      </div>
    </PageMain>
  );
}
