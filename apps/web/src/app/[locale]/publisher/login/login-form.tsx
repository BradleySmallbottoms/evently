'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError } from '@local-events/api-client';
import { Link, useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';

export function LoginForm() {
  const t = useTranslations('Publisher');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      throwIfError(
        await api.POST('/v1/publishers/login', {
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
    <form action={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('email')}</span>
        <input
          name="email"
          type="email"
          required
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('password')}</span>
        <input
          name="password"
          type="password"
          required
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t('loginSubmit')}
      </button>
      <p className="text-sm text-zinc-600">
        <Link href="/publisher/register" className="underline underline-offset-4">
          {t('registerTitle')}
        </Link>
        {' · '}
        <Link href="/publisher/verify" className="underline underline-offset-4">
          {t('verifyTitle')}
        </Link>
      </p>
    </form>
  );
}
