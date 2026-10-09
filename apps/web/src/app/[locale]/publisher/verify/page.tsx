import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { VerifyForm } from './components/verify-form';

export default async function VerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Publisher');
  const nav = await getTranslations('Nav');

  return (
    <PageMain maxWidth="sm">
      <Stack spacing={1}>
        <Link component={AppLink} href="/" underline="hover" variant="body2" color="text.secondary">
          {nav('home')}
        </Link>
        <Typography variant="h4" component="h1">
          {t('verifyTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('registerSuccess')}
        </Typography>
      </Stack>
      <Suspense fallback={null}>
        <VerifyForm />
      </Suspense>
    </PageMain>
  );
}
