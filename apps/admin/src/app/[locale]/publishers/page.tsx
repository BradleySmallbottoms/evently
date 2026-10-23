import { setRequestLocale } from 'next-intl/server';
import { PublishersBoard } from './components/publishers-board';

export const instant = false;

export default async function PublishersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PublishersBoard />;
}
