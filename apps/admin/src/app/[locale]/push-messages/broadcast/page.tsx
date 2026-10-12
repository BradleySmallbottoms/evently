import { setRequestLocale } from 'next-intl/server';
import { BroadcastComposer } from './components/broadcast-composer';

export default async function BroadcastPushPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <BroadcastComposer />;
}
