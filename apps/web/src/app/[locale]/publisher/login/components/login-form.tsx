'use client';

import { ApiError } from '@local-events/api-client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { OtpCodeInput } from '@/components/otp-code-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';

type Step =
  | { name: 'password' }
  | { name: 'otp-email' }
  | { name: 'otp-code'; email: string; devCode?: string }
  | { name: 'totp'; challengeToken: string };

const CODE_AUTO_SUBMIT_MS = 500;

export function LoginForm() {
  const t = useTranslations('Publisher');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ name: 'password' });
  const pendingRef = useRef(false);

  function fail(err: unknown) {
    if (err instanceof ApiError && err.code === 'email_unverified') setError(t('errorUnverified'));
    else if (err instanceof ApiError && err.code === 'invalid_credentials') {
      setError(t('errorCredentials'));
    } else if (
      err instanceof ApiError &&
      (err.code === 'invalid_otp' || err.code === 'otp_expired')
    ) {
      setError(t('errorOtp'));
    } else if (err instanceof ApiError && err.code === 'otp_rate_limited') {
      setError(t('errorOtpRate'));
    } else if (
      err instanceof ApiError &&
      (err.code === 'invalid_totp' || err.code === 'challenge_expired')
    ) {
      setError(t('errorTotp'));
    } else setError(err instanceof Error ? err.message : t('errorGeneric'));
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const body = throwIfError(
        await api.POST('/publishers/login', {
          body: {
            email: String(formData.get('email') ?? ''),
            password: String(formData.get('password') ?? ''),
          },
        }),
      );
      if (body.status === 'totp_required') {
        setCode('');
        setStep({ name: 'totp', challengeToken: body.challengeToken });
        return;
      }
      router.push('/publisher');
    } catch (err) {
      fail(err);
    } finally {
      setPending(false);
    }
  }

  async function onRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const email = String(new FormData(event.currentTarget).get('email') ?? '');
      const body = throwIfError(await api.POST('/publishers/login/otp', { body: { email } }));
      setCode('');
      setStep({ name: 'otp-code', email, devCode: body.code });
    } catch (err) {
      fail(err);
    } finally {
      setPending(false);
    }
  }

  async function confirmCode(nextCode: string) {
    if (step.name !== 'otp-code' || nextCode.length !== 6 || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const body = throwIfError(
        await api.POST('/publishers/login/otp/confirm', {
          body: { email: step.email, code: nextCode },
        }),
      );
      if (body.status === 'totp_required') {
        setCode('');
        setStep({ name: 'totp', challengeToken: body.challengeToken });
        return;
      }
      router.push('/publisher');
    } catch (err) {
      setCode('');
      fail(err);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function confirmTotp(nextCode: string) {
    if (step.name !== 'totp' || nextCode.length !== 6 || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const body = throwIfError(
        await api.POST('/publishers/login/totp', {
          body: { token: step.challengeToken, code: nextCode },
        }),
      );
      if (body.status === 'totp_required') {
        setCode('');
        setError(t('errorTotp'));
        return;
      }
      router.push('/publisher');
    } catch (err) {
      setCode('');
      if (err instanceof ApiError && err.code === 'challenge_expired') {
        setStep({ name: 'password' });
      }
      fail(err);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (code.length !== 6 || pendingRef.current) return;
    if (step.name !== 'totp' && step.name !== 'otp-code') return;
    const timer = window.setTimeout(() => {
      if (step.name === 'totp') void confirmTotp(code);
      else void confirmCode(code);
    }, CODE_AUTO_SUBMIT_MS);
    return () => window.clearTimeout(timer);
    // confirm functions close over step; re-run when the code or step changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fire only when code is complete
  }, [code, step]);

  return (
    <div className="flex flex-col gap-4">
      {step.name === 'password' ? (
        <form onSubmit={onPassword}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="publisher-email">{t('email')}</FieldLabel>
              <Input id="publisher-email" name="email" type="email" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="publisher-password">{t('password')}</FieldLabel>
              <Input id="publisher-password" name="password" type="password" required />
            </Field>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" variant="brand" disabled={pending}>
              {t('loginSubmit')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep({ name: 'otp-email' })}>
              {t('loginWithCode')}
            </Button>
          </FieldGroup>
        </form>
      ) : null}

      {step.name === 'otp-email' ? (
        <form onSubmit={onRequestCode}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="publisher-otp-email">{t('email')}</FieldLabel>
              <Input id="publisher-otp-email" name="email" type="email" required />
            </Field>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" variant="brand" disabled={pending}>
              {t('sendCode')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep({ name: 'password' })}>
              {t('loginWithPassword')}
            </Button>
          </FieldGroup>
        </form>
      ) : null}

      {step.name === 'otp-code' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirmCode(code);
          }}
        >
          <FieldGroup>
            <p className="text-sm text-muted-foreground">{t('codeSent')}</p>
            {step.devCode ? (
              <p className="text-sm text-muted-foreground">
                {t('devCode', { code: step.devCode })}
              </p>
            ) : null}
            <OtpCodeInput
              label={t('code')}
              value={code}
              onChange={setCode}
              disabled={pending}
              autoFocus
            />
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" variant="brand" disabled={pending || code.length !== 6}>
              {t('loginSubmit')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCode('');
                setStep({ name: 'otp-email' });
              }}
            >
              {t('sendCode')}
            </Button>
          </FieldGroup>
        </form>
      ) : null}

      {step.name === 'totp' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirmTotp(code);
          }}
        >
          <FieldGroup>
            <OtpCodeInput
              label={t('totpCode')}
              value={code}
              onChange={setCode}
              disabled={pending}
              autoFocus
            />
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" variant="brand" disabled={pending || code.length !== 6}>
              {t('loginSubmit')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCode('');
                setError(null);
                setStep({ name: 'password' });
              }}
            >
              {t('loginWithPassword')}
            </Button>
          </FieldGroup>
        </form>
      ) : null}

      <p className="text-sm text-muted-foreground">
        <AppLink href="/publisher/register" className="underline-offset-4 hover:underline">
          {t('registerTitle')}
        </AppLink>
        {' · '}
        <AppLink href="/publisher/verify" className="underline-offset-4 hover:underline">
          {t('verifyTitle')}
        </AppLink>
      </p>
    </div>
  );
}
