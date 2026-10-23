import { setRequestLocale } from 'next-intl/server';
import { PushMessagesPanel } from './components/push-messages-panel';

export const instant = false;

export default async function PushMessagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PushMessagesPanel />;
}
