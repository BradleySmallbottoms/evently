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

type Step =
  | { name: 'password' }
  | { name: 'otp-email' }
  | { name: 'otp-code'; email: string; devCode?: string }
  | { name: 'totp'; challenge: Challenge };

const CODE_AUTO_SUBMIT_MS = 500;

export function LoginForm() {
  const t = useTranslations('Login');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [otpEmail, setOtpEmail] = useState('');
  const [code, setCode] = useState('');
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
      setCode('');
      setStep({ name: 'totp', challenge: body });
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

  async function requestOtp(email: string) {
    const trimmed = email.trim();
    if (!trimmed || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const body = await adminFetch<{ status: 'code_sent'; code?: string }>('/admin/login/otp', {
        method: 'POST',
        body: JSON.stringify({ email: trimmed }),
      });
      setCode('');
      setStep({ name: 'otp-code', email: trimmed, devCode: body.code });
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'otp_rate_limited') {
        setError(t('errorRateLimit'));
      } else {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
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
      const token =
        step.challenge.status === 'totp_setup'
          ? step.challenge.setupToken
          : step.challenge.challengeToken;
      await adminFetch('/admin/login/totp', {
        method: 'POST',
        body: JSON.stringify({ token, code: nextCode }),
      });
      await queryClient.invalidateQueries({ queryKey: ADMIN_ME_QUERY_KEY });
      router.push('/publishers');
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'invalid_totp') {
        setError(t('errorTotp'));
        setCode('');
      } else if (err instanceof AdminApiError && err.code === 'challenge_expired') {
        setError(t('errorExpired'));
        setStep({ name: 'password' });
        setCode('');
      } else {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function confirmOtp(nextCode: string) {
    if (step.name !== 'otp-code' || nextCode.length !== 6 || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await adminFetch('/admin/login/otp/confirm', {
        method: 'POST',
        body: JSON.stringify({ email: step.email, code: nextCode }),
      });
      await queryClient.invalidateQueries({ queryKey: ADMIN_ME_QUERY_KEY });
      router.push('/publishers');
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'invalid_otp') {
        setError(t('errorOtp'));
        setCode('');
      } else if (err instanceof AdminApiError && err.code === 'otp_expired') {
        setError(t('errorOtpExpired'));
        setStep({ name: 'otp-email' });
        setCode('');
      } else {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
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
      else void confirmOtp(code);
    }, CODE_AUTO_SUBMIT_MS);
    return () => window.clearTimeout(timer);
    // confirm functions close over step; re-run when the code or step changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fire only when code is complete
  }, [code, step]);

  if (step.name === 'totp') {
    const challenge = step.challenge;
    return (
      <div className="flex w-full flex-1 items-center justify-center">
        <form
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmTotp(code);
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
            value={code}
            onChange={setCode}
            disabled={pending}
            autoFocus
          />
          {error ? (
            <Alert variant="destructive" className="w-full text-left">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t('confirmTotp')}
          </Button>
        </form>
      </div>
    );
  }

  if (step.name === 'otp-email' || step.name === 'otp-code') {
    return (
      <div className="flex w-full flex-1 items-center justify-center">
        <form
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            if (step.name === 'otp-email') void requestOtp(otpEmail);
            else void confirmOtp(code);
          }}
          className="flex w-full max-w-[420px] flex-col items-center gap-4 text-center"
        >
          <h1 className="text-2xl font-semibold">{t('otpTitle')}</h1>
          {step.name === 'otp-email' ? (
            <>
              <p className="text-sm text-muted-foreground">{t('otpHint')}</p>
              <FieldGroup className="w-full text-left">
                <Field>
                  <FieldLabel htmlFor="otp-email">{t('email')}</FieldLabel>
                  <Input
                    id="otp-email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    value={otpEmail}
                    onChange={(event) => setOtpEmail(event.target.value)}
                  />
                </Field>
              </FieldGroup>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t('otpSent')}</p>
              {step.devCode ? (
                <Alert className="w-full text-left">
                  <AlertDescription>
                    {t('otpDevCode')}{' '}
                    <span className="font-mono tracking-widest">{step.devCode}</span>
                  </AlertDescription>
                </Alert>
              ) : null}
              <OtpCodeInput
                label={t('otpCode')}
                value={code}
                onChange={setCode}
                disabled={pending}
                autoFocus
              />
            </>
          )}
          {error ? (
            <Alert variant="destructive" className="w-full text-left">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={pending || (step.name === 'otp-code' && code.length !== 6)}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {step.name === 'otp-email' ? t('sendCode') : t('confirmOtp')}
          </Button>
          {step.name === 'otp-code' ? (
            <Button
              type="button"
              variant="link"
              disabled={pending}
              onClick={() => void requestOtp(step.email)}
            >
              {t('sendAgain')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setError(null);
              setCode('');
              setStep({ name: 'password' });
            }}
          >
            {t('usePassword')}
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
        <Button
          type="button"
          variant="link"
          onClick={() => {
            setError(null);
            setStep({ name: 'otp-email' });
          }}
        >
          {t('useCode')}
        </Button>
      </form>
    </div>
  );
}
