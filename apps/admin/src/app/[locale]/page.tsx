import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function AdminHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('App');

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{t('name')}</CardTitle>
        <CardDescription>{t('tagline')}</CardDescription>
      </CardHeader>
    </Card>
  );
}
