import Typography from '@mui/material/Typography';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function AdminHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('App');

  return (
    <>
      <Typography variant="h3" component="h1" gutterBottom>
        {t('name')}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t('tagline')}
      </Typography>
      <Typography>
        <Link href="/publishers">{t('navPublishers')}</Link>
        {' · '}
        <Link href="/login">{t('navLogin')}</Link>
      </Typography>
    </>
  );
}
