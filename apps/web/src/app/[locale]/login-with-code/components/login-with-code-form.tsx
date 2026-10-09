'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { ApiError } from '@local-events/api-client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, throwIfError } from '@/lib/api';

type Props = {
  initialCode?: string;
};

export function LoginWithCodeForm({ initialCode }: Props) {
  const t = useTranslations('Pairing');
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const autoTried = useRef(false);

  async function exchange(code: string) {
    setPending(true);
    setError(null);
    setUserId(null);
    try {
      const body = throwIfError(
        await api.POST('/pairing/login', {
          body: { code: code.trim() },
        }),
      );
      setUserId(body.userId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_pairing_code') {
        setError(t('invalidCode'));
      } else {
        setError(err instanceof Error ? err.message : t('loginError'));
      }
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    const code = initialCode?.trim();
    if (!code || autoTried.current) return;
    autoTried.current = true;
    void exchange(code);
    // Auto-exchange once when the URL carries a code (e2e + deep links).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot
  }, [initialCode]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const code = String(formData.get('code') ?? '');
    if (!code.trim()) return;
    await exchange(code);
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={2}>
      <TextField
        name="code"
        label={t('codeLabel')}
        required
        fullWidth
        defaultValue={initialCode ?? ''}
        disabled={pending}
        slotProps={{
          htmlInput: {
            minLength: 8,
            maxLength: 16,
            autoCapitalize: 'characters',
            autoCorrect: 'off',
            spellCheck: false,
            style: {
              fontFamily: 'ui-monospace, monospace',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            },
          },
        }}
      />
      {error && <Alert severity="error">{error}</Alert>}
      {userId && <Alert severity="success">{t('loginSuccess', { userId })}</Alert>}
      <Button type="submit" variant="contained" disabled={pending}>
        {t('submit')}
      </Button>
    </Stack>
  );
}
