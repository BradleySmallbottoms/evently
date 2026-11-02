import { getTranslations } from 'next-intl/server';
import { LegalSection } from '@/components/legal-section';
import { MailLink, companyMessageValues } from '@/components/legal-contact';

const sectionIds = [
  'who',
  'identity',
  'optional',
  'location',
  'content',
  'calendar',
  'crash',
  'deletion',
  'rights',
] as const;

export async function PrivacyPolicy() {
  const t = await getTranslations('Legal');
  const values = companyMessageValues();

  return (
    <>
      {sectionIds.map((id) => (
        <LegalSection key={id} title={t(`privacy.${id}.title`)}>
          <p>{t.rich(`privacy.${id}.body`, { ...values, mail: MailLink })}</p>
        </LegalSection>
      ))}
    </>
  );
}
