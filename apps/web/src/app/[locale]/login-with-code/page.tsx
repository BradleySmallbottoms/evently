import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1';
export const instant = false;

async function LoginWithCodeResult({
  code,
  invalidCodeText,
  loginSuccessText,
}: {
  code: string | undefined;
  invalidCodeText: string;
  loginSuccessText: (values: { userId: string }) => string;
}) {
  let successUserId: string | null = null;
  let error: string | null = null;

  if (code && code.trim().length > 0) {
    const login = await fetch(`${API_URL}/pairing/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      cache: 'no-store',
    });
    if (login.ok) {
      const body = (await login.json()) as { userId: string };
      successUserId = body.userId;
    } else {
      error = invalidCodeText;
    }
  }

  if (!error && !successUserId) return null;

  return (
    <>
      {error && <Alert severity="error">{error}</Alert>}
      {successUserId && (
        <Alert severity="success">{loginSuccessText({ userId: successUserId })}</Alert>
      )}
    </>
  );
}

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
      <Stack component="form" method="GET" spacing={2}>
        <TextField
          name="code"
          label={t('codeLabel')}
          required
          fullWidth
          defaultValue={code ?? ''}
          slotProps={{
            htmlInput: {
              minLength: 8,
              maxLength: 16,
              style: {
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              },
            },
          }}
        />
        <Suspense fallback={null}>
          <LoginWithCodeResult
            code={code}
            invalidCodeText={t('invalidCode')}
            loginSuccessText={(values) => t('loginSuccess', values)}
          />
        </Suspense>
        <Button type="submit" variant="contained">
          {t('submit')}
        </Button>
      </Stack>
    </PageMain>
  );
}
