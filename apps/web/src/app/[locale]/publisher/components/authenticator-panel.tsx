'use client';

import { ApiError } from '@local-events/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { OtpCodeInput } from '@/components/otp-code-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, throwIfError } from '@/lib/api';

export function AuthenticatorPanel({ enabled }: { enabled: boolean }) {
  const t = useTranslations('Publisher');
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const setup = useMutation({
    mutationFn: async () => throwIfError(await api.POST('/publishers/me/totp/setup')),
    onSuccess: (body) => {
      setSecret(body.secret);
      setOtpauthUrl(body.otpauthUrl);
      setError(null);
    },
    onError: () => setError(t('errorGeneric')),
  });

  const confirm = useMutation({
    mutationFn: async (input: { code: string; password: string }) =>
      throwIfError(await api.POST('/publishers/me/totp/confirm', { body: input })),
    onSuccess: async () => {
      setSecret(null);
      setOtpauthUrl(null);
      setCode('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['publisher-me'] });
    },
    onError: (err) => {
      setCode('');
      setError(
        err instanceof ApiError && err.code === 'invalid_credentials'
          ? t('errorCredentials')
          : t('errorTotp'),
      );
    },
  });

  const disable = useMutation({
    mutationFn: async (input: { code: string; password: string }) =>
      throwIfError(await api.DELETE('/publishers/me/totp', { body: input })),
    onSuccess: async () => {
      setCode('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['publisher-me'] });
    },
    onError: (err) => {
      setCode('');
      setError(
        err instanceof ApiError && err.code === 'invalid_credentials'
          ? t('errorCredentials')
          : t('errorTotp'),
      );
    },
  });

  function onConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    confirm.mutate({
      code,
      password: String(new FormData(event.currentTarget).get('password') ?? ''),
    });
  }

  function onDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    disable.mutate({
      code,
      password: String(new FormData(event.currentTarget).get('password') ?? ''),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('authenticatorTitle')}</CardTitle>
        <CardDescription>{enabled ? t('authenticatorOn') : t('authenticatorOff')}</CardDescription>
      </CardHeader>
      <CardContent>
        {enabled ? (
          <form onSubmit={onDisable}>
            <FieldGroup>
              <OtpCodeInput
                label={t('totpCode')}
                value={code}
                onChange={setCode}
                disabled={disable.isPending}
                autoFocus
              />
              <Field>
                <FieldLabel htmlFor="totp-off-password">{t('password')}</FieldLabel>
                <Input id="totp-off-password" name="password" type="password" required />
              </Field>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="submit"
                variant="outline"
                disabled={disable.isPending || code.length !== 6}
              >
                {t('authenticatorDisable')}
              </Button>
            </FieldGroup>
          </form>
        ) : secret ? (
          <form onSubmit={onConfirm}>
            <FieldGroup>
              <p className="text-sm text-muted-foreground">{t('authenticatorSecret')}</p>
              <p className="font-mono text-sm break-all">{secret}</p>
              {otpauthUrl ? (
                <p className="text-sm break-all text-muted-foreground">{otpauthUrl}</p>
              ) : null}
              <OtpCodeInput
                label={t('totpCode')}
                value={code}
                onChange={setCode}
                disabled={confirm.isPending}
                autoFocus
              />
              <Field>
                <FieldLabel htmlFor="totp-on-password">{t('password')}</FieldLabel>
                <Input id="totp-on-password" name="password" type="password" required />
              </Field>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="submit"
                variant="brand"
                disabled={confirm.isPending || code.length !== 6}
              >
                {t('authenticatorConfirm')}
              </Button>
            </FieldGroup>
          </form>
        ) : (
          <FieldGroup>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={setup.isPending}
              onClick={() => setup.mutate()}
            >
              {t('authenticatorStart')}
            </Button>
          </FieldGroup>
        )}
      </CardContent>
    </Card>
  );
}
