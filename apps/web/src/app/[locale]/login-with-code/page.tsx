import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { LoginWithCodeForm } from './components/login-with-code-form';

export default async function LoginWithCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { locale } = await params;
  const { code } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('Pairing');
  const nav = await getTranslations('Nav');

  return (
    <PageMain maxWidth="sm">
      <Stack spacing={1}>
        <Link component={AppLink} href="/" underline="hover" variant="body2" color="text.secondary">
          {nav('home')}
        </Link>
        <Typography variant="h4" component="h1">
          {t('title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('description')}
        </Typography>
      </Stack>
      <LoginWithCodeForm initialCode={code} />
    </PageMain>
  );
}
