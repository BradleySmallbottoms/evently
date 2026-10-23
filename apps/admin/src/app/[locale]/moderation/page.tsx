import { setRequestLocale } from 'next-intl/server';
import { ModerationPanel } from './components/moderation-panel';

export const instant = false;

export default async function ModerationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ModerationPanel />;
}
