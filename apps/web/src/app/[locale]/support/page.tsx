import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal-document';
import { SupportContent } from './components/support-content';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Legal' });
  return { title: t('supportTitle'), description: t('supportDescription') };
}

export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Legal');

  return (
    <LegalDocument locale={locale} title={t('supportTitle')}>
      <SupportContent />
    </LegalDocument>
  );
}
