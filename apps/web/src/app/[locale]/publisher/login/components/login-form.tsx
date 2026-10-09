'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ApiError } from '@local-events/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';

export function LoginForm() {
  const t = useTranslations('Publisher');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      throwIfError(
        await api.POST('/publishers/login', {
          body: {
            email: String(formData.get('email') ?? ''),
            password: String(formData.get('password') ?? ''),
          },
        }),
      );
      router.push('/publisher');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_unverified') {
        setError(t('errorUnverified'));
      } else if (err instanceof ApiError && err.code === 'invalid_credentials') {
        setError(t('errorCredentials'));
      } else {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={2}>
      <TextField name="email" type="email" label={t('email')} required fullWidth />
      <TextField name="password" type="password" label={t('password')} required fullWidth />
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" variant="contained" disabled={pending}>
        {t('loginSubmit')}
      </Button>
      <Typography variant="body2" color="text.secondary">
        <Link component={AppLink} href="/publisher/register" underline="hover">
          {t('registerTitle')}
        </Link>
        {' · '}
        <Link component={AppLink} href="/publisher/verify" underline="hover">
          {t('verifyTitle')}
        </Link>
      </Typography>
    </Stack>
  );
}
