import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('App');
  const nav = await getTranslations('Nav');

  return (
    <PageMain maxWidth="sm" sx={{ justifyContent: 'center' }}>
      <Stack spacing={1.5}>
        <Typography variant="h3" component="h1">
          {t('name')}
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 400 }}>
          {t('tagline')}
        </Typography>
      </Stack>
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        <Button component={AppLink} href="/events" variant="contained">
          {nav('events')}
        </Button>
        <Button component={AppLink} href="/login-with-code" variant="outlined">
          {nav('loginWithCode')}
        </Button>
        <Button component={AppLink} href="/publisher/login" variant="outlined">
          {nav('publisherLogin')}
        </Button>
        <Button component={AppLink} href="/publisher/register" variant="text">
          {nav('publisherRegister')}
        </Button>
      </Stack>
    </PageMain>
  );
}
