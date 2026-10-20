'use client';

import { ApiError } from '@local-events/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="publisher-email">{t('email')}</Label>
        <Input id="publisher-email" name="email" type="email" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="publisher-password">{t('password')}</Label>
        <Input id="publisher-password" name="password" type="password" required />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant="brand" disabled={pending}>
        {t('loginSubmit')}
      </Button>
      <p className="text-sm text-muted-foreground">
        <AppLink href="/publisher/register" className="underline-offset-4 hover:underline">
          {t('registerTitle')}
        </AppLink>
        {' · '}
        <AppLink href="/publisher/verify" className="underline-offset-4 hover:underline">
          {t('verifyTitle')}
        </AppLink>
      </p>
    </form>
  );
}
