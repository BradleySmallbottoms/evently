'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';
import { OtpCodeInput } from './otp-code-input';
import { TotpQr } from './totp-qr';

type Challenge =
  | { status: 'totp_required'; challengeToken: string }
  | { status: 'totp_setup'; setupToken: string; otpauthUrl: string; secret: string };

const TOTP_AUTO_SUBMIT_MS = 1000;

const styles: Record<string, SxProps<Theme>> = {
  screen: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  form: {
    width: '100%',
    maxWidth: 420,
  },
  stack: {
    alignItems: 'center',
    textAlign: 'center',
  },
  fullWidth: {
    width: '100%',
  },
};

export function LoginForm() {
  const t = useTranslations('Login');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const pendingRef = useRef(false);

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const body = await adminFetch<Challenge>('/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          email: String(formData.get('email') ?? ''),
          password: String(formData.get('password') ?? ''),
        }),
      });
      setTotpCode('');
      setChallenge(body);
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'invalid_credentials') {
        setError(t('errorCredentials'));
      } else {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    } finally {
      setPending(false);
    }
  }

  async function confirmTotp(code: string) {
    if (!challenge || code.length !== 6 || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const token =
        challenge.status === 'totp_setup' ? challenge.setupToken : challenge.challengeToken;
      await adminFetch('/admin/login/totp', {
        method: 'POST',
        body: JSON.stringify({ token, code }),
      });
      router.push('/publishers');
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'invalid_totp') {
        setError(t('errorTotp'));
        setTotpCode('');
      } else if (err instanceof AdminApiError && err.code === 'challenge_expired') {
        setError(t('errorExpired'));
        setChallenge(null);
        setTotpCode('');
      } else {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (!challenge || totpCode.length !== 6 || pendingRef.current) return;
    const timer = window.setTimeout(() => {
      void confirmTotp(totpCode);
    }, TOTP_AUTO_SUBMIT_MS);
    return () => window.clearTimeout(timer);
    // confirmTotp closes over challenge/t/router; re-run when code or challenge changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fire only when code is complete
  }, [totpCode, challenge]);

  if (challenge) {
    return (
      <Box sx={styles.screen}>
        <Box
          component="form"
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmTotp(totpCode);
          }}
          sx={styles.form}
        >
          <Stack spacing={2} sx={styles.stack}>
            <Typography variant="h4" component="h1">
              {challenge.status === 'totp_setup' ? t('setupTitle') : t('title')}
            </Typography>
            {challenge.status === 'totp_setup' ? (
              <>
                <Typography color="text.secondary">{t('setupHint')}</Typography>
                <TotpQr otpauthUrl={challenge.otpauthUrl} />
              </>
            ) : null}
            <OtpCodeInput
              label={t('totpCode')}
              value={totpCode}
              onChange={setTotpCode}
              disabled={pending}
              autoFocus
            />
            {error ? (
              <Alert severity="error" sx={styles.fullWidth}>
                {error}
              </Alert>
            ) : null}
            <Button
              type="submit"
              variant="contained"
              disabled={pending || totpCode.length !== 6}
              sx={styles.fullWidth}
            >
              {t('confirmTotp')}
            </Button>
          </Stack>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={styles.screen}>
      <Box component="form" method="post" onSubmit={onPassword} sx={styles.form}>
        <Stack spacing={2} sx={styles.stack}>
          <Typography variant="h4" component="h1">
            {t('title')}
          </Typography>
          <TextField
            name="email"
            type="email"
            label={t('email')}
            required
            fullWidth
            autoFocus
            sx={styles.fullWidth}
          />
          <TextField
            name="password"
            type="password"
            label={t('password')}
            required
            fullWidth
            sx={styles.fullWidth}
          />
          {error ? (
            <Alert severity="error" sx={styles.fullWidth}>
              {error}
            </Alert>
          ) : null}
          <Button type="submit" variant="contained" disabled={pending} sx={styles.fullWidth}>
            {t('continue')}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
