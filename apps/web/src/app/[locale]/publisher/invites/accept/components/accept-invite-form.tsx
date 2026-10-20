'use client';

import { ApiError } from '@local-events/api-client';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-token">{t('inviteToken')}</Label>
        <Input id="invite-token" name="token" required defaultValue={initialToken} />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant="brand" disabled={pending}>
        {t('acceptInvite')}
      </Button>
      <p className="text-sm text-muted-foreground">
        <AppLink href="/publisher/login" className="underline-offset-4 hover:underline">
          {t('loginTitle')}
        </AppLink>
      </p>
    </form>
  );
}
