import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal-document';
import { PrivacyPolicy } from './components/privacy-policy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Legal' });
  return { title: t('privacyTitle'), description: t('privacyDescription') };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Legal');

  return (
    <LegalDocument locale={locale} title={t('privacyTitle')}>
      <PrivacyPolicy />
    </LegalDocument>
  );
}
