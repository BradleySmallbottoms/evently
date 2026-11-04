import { setRequestLocale } from 'next-intl/server';
import { PublisherAccountsPanel } from './components/publisher-accounts-panel';

export const instant = false;

export default async function PublisherAccountsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PublisherAccountsPanel />;
}
