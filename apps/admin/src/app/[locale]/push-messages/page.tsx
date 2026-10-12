import { setRequestLocale } from 'next-intl/server';
import { PushMessagesPanel } from './components/push-messages-panel';

export default async function PushMessagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PushMessagesPanel />;
}
