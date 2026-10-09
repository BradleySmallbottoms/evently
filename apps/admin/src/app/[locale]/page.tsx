import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminHome } from '@/components/admin-home';

export default async function AdminHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('App');

  return (
    <AdminHome
      name={t('name')}
      tagline={t('tagline')}
      apiUrl={process.env.NEXT_PUBLIC_ADMIN_API_URL ?? 'http://localhost:3001'}
    />
  );
}
