import { setRequestLocale } from 'next-intl/server';
import { VerificationQueue } from './components/verification-queue';

export default async function PublishersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <VerificationQueue />;
}
