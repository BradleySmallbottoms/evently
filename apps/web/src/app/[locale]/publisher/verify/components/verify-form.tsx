'use client';

import { useSearchParams } from 'next/navigation';
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="verify-token">{t('verifyToken')}</Label>
        <Input
          id="verify-token"
          name="token"
          type="text"
          required
          defaultValue={initialToken}
          className="font-mono text-sm"
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{t('verifySuccess')}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant="brand" disabled={pending}>
        {t('verifySubmit')}
      </Button>
      <p className="text-sm text-muted-foreground">
        <AppLink href="/publisher/login" className="underline-offset-4 hover:underline">
          {t('loginTitle')}
        </AppLink>
      </p>
    </form>
  );
}
