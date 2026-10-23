import { setRequestLocale } from 'next-intl/server';
import { EventCatalog } from '../components/event-catalog';

export const instant = false;

export default async function EventManagePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <EventCatalog />;
}
