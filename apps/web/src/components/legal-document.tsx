import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { PublicFooter } from '@/components/public-footer';
import { company, formatPolicyDate } from '@/lib/company';

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

export async function LegalDocument({
  locale,
  title,
  children,
}: {
  locale: string;
  title: string;
  children: React.ReactNode;
}) {
  setRequestLocale(locale);
  const nav = await getTranslations('Nav');
  const t = await getTranslations('Legal');

  return (
    <PageMain>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <AppLink href="/" className={backLinkClass}>
            {nav('home')}
          </AppLink>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {t('updated', { date: formatPolicyDate(locale) })}
          </p>
          <p className="text-sm text-muted-foreground">{company.name}</p>
        </div>
        {children}
      </div>
      <PublicFooter />
    </PageMain>
  );
}
