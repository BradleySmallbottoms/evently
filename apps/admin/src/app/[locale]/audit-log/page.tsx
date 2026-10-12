import { setRequestLocale } from 'next-intl/server';
import { AuditLogPanel } from './components/audit-log-panel';

export default async function AuditLogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AuditLogPanel />;
}
