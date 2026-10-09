'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';

export function VerifyForm() {
  const t = useTranslations('Publisher');
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialToken = searchParams.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      throwIfError(
        await api.POST('/publishers/verify-email', {
          body: { token: String(formData.get('token') ?? '') },
        }),
      );
      setSuccess(true);
      router.push('/publisher/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={2}>
      <TextField
        name="token"
        type="text"
        label={t('verifyToken')}
        required
        fullWidth
        defaultValue={initialToken}
        slotProps={{
          input: { sx: { fontFamily: 'ui-monospace, monospace', fontSize: 14 } },
        }}
      />
      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{t('verifySuccess')}</Alert>}
      <Button type="submit" variant="contained" disabled={pending}>
        {t('verifySubmit')}
      </Button>
      <Typography variant="body2" color="text.secondary">
        <Link component={AppLink} href="/publisher/login" underline="hover">
          {t('loginTitle')}
        </Link>
      </Typography>
    </Stack>
  );
}
