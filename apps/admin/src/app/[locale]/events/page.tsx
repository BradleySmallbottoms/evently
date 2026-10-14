import { redirect } from '@/i18n/navigation';

export default async function EventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: '/review', locale });
}
