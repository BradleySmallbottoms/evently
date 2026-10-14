import { setRequestLocale } from 'next-intl/server';
import { ReviewBoard } from './components/review-board';

export default async function ReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ReviewBoard />;
}
