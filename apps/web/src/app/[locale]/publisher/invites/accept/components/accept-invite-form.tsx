'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ApiError } from '@local-events/api-client';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';

export function AcceptInviteForm() {
  const t = useTranslations('Publisher');
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialToken = searchParams.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const result = throwIfError(
        await api.POST('/publishers/invites/accept', {
          body: { token: String(formData.get('token') ?? '') },
        }),
      );
      router.push(`/publisher/${result.publisherId}/settings`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthorized') {
        setError(t('errorCredentials'));
      } else if (err instanceof ApiError && err.code === 'invite_email_mismatch') {
        setError(t('errorInviteEmailMismatch'));
      } else if (err instanceof ApiError && err.code === 'invalid_token') {
        setError(t('errorInvalidInvite'));
      } else if (err instanceof ApiError && err.code === 'already_member') {
        setError(t('errorAlreadyMember'));
      } else {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={2}>
      <TextField
        name="token"
        label={t('inviteToken')}
        required
        fullWidth
        defaultValue={initialToken}
      />
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" variant="contained" disabled={pending}>
        {t('acceptInvite')}
      </Button>
      <Typography variant="body2" color="text.secondary">
        <Link component={AppLink} href="/publisher/login" underline="hover">
          {t('loginTitle')}
        </Link>
      </Typography>
    </Stack>
  );
}
