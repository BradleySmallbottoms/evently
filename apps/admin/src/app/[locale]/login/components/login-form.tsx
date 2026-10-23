'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from '@/i18n/navigation';
import { ADMIN_ME_QUERY_KEY } from '@/lib/admin-session';
import { AdminApiError, adminFetch } from '@/lib/api';
import { OtpCodeInput } from './otp-code-input';
import { TotpQr } from './totp-qr';

type Challenge =
  | { status: 'totp_required'; challengeToken: string }
  | { status: 'totp_setup'; setupToken: string; otpauthUrl: string; secret: string };

const TOTP_AUTO_SUBMIT_MS = 500;

export function LoginForm() {
  const t = useTranslations('Login');
  const router = useRouter();
  const queryClient = useQueryClient();
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
      await queryClient.invalidateQueries({ queryKey: ADMIN_ME_QUERY_KEY });
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
      <div className="flex w-full flex-1 items-center justify-center">
        <form
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmTotp(totpCode);
          }}
          className="flex w-full max-w-[420px] flex-col items-center gap-4 text-center"
        >
          <h1 className="text-2xl font-semibold">
            {challenge.status === 'totp_setup' ? t('setupTitle') : t('title')}
          </h1>
          {challenge.status === 'totp_setup' ? (
            <>
              <p className="text-sm text-muted-foreground">{t('setupHint')}</p>
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
            <Alert variant="destructive" className="w-full text-left">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending || totpCode.length !== 6}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t('confirmTotp')}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 items-center justify-center">
      <form
        method="post"
        onSubmit={onPassword}
        className="flex w-full max-w-[420px] flex-col items-center gap-4 text-center"
      >
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <FieldGroup className="w-full text-left">
          <Field>
            <FieldLabel htmlFor="login-email">{t('email')}</FieldLabel>
            <Input id="login-email" name="email" type="email" required autoFocus />
          </Field>
          <Field>
            <FieldLabel htmlFor="login-password">{t('password')}</FieldLabel>
            <Input id="login-password" name="password" type="password" required />
          </Field>
        </FieldGroup>
        {error ? (
          <Alert variant="destructive" className="w-full text-left">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t('continue')}
        </Button>
      </form>
    </div>
  );
}
