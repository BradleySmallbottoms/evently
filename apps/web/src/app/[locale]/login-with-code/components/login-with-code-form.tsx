'use client';

import { ApiError } from '@local-events/api-client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="pairing-code">{t('codeLabel')}</Label>
        <Input
          id="pairing-code"
          name="code"
          required
          defaultValue={initialCode ?? ''}
          disabled={pending}
          minLength={8}
          maxLength={16}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono tracking-[0.08em] uppercase"
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {userId && (
        <Alert>
          <AlertDescription>{t('loginSuccess', { userId })}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant="brand" disabled={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
