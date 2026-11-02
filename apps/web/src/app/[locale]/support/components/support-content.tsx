import { getTranslations } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { Card, CardContent } from '@/components/ui/card';
import { LegalSection } from '@/components/legal-section';
import { MailLink, companyMessageValues } from '@/components/legal-contact';
import { company } from '@/lib/company';

const linkClass = 'text-foreground underline underline-offset-4 hover:underline';

export async function SupportContent() {
  const t = await getTranslations('Legal');
  const values = companyMessageValues();

  return (
    <>
      <p className="text-base leading-7 text-foreground">{t('supportIntro')}</p>
      <Card>
        <CardContent className="flex flex-col gap-4 text-base leading-7">
          <div>
            <p className="text-sm text-muted-foreground">{t('emailLabel')}</p>
            <a href={`mailto:${company.email}`} className={linkClass}>
              {company.email}
            </a>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('phoneLabel')}</p>
            <a href={company.phoneHref} className={linkClass}>
              {company.phone}
            </a>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('addressLabel')}</p>
            <p>
              {company.name}
              <br />
              {company.street}
              <br />
              {company.postalCode} {company.city}
            </p>
          </div>
        </CardContent>
      </Card>
      <LegalSection title={t('support.how.title')}>
        <p>{t('support.how.body')}</p>
      </LegalSection>
      <LegalSection title={t('support.deletion.title')}>
        <p>{t.rich('support.deletion.body', { ...values, mail: MailLink })}</p>
      </LegalSection>
      <p>
        <AppLink href="/integritet" className={linkClass}>
          {t('privacyCta')}
        </AppLink>
      </p>
    </>
  );
}
