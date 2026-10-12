import { setRequestLocale } from 'next-intl/server';
import { ReviewQueue } from './components/review-queue';

export default async function EventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ReviewQueue />;
}
