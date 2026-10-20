import { setRequestLocale } from 'next-intl/server';
import { SourcesPanel } from './components/sources-panel';

export default async function DataSourcesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SourcesPanel />;
}
