'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';

export function VerifyForm() {
  const t = useTranslations('Publisher');
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialToken = searchParams.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      throwIfError(
        await api.POST('/v1/publishers/verify-email', {
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
    <form action={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('verifyToken')}</span>
        <input
          name="token"
          type="text"
          required
          defaultValue={initialToken}
          className="rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">{t('verifySuccess')}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t('verifySubmit')}
      </button>
      <p className="text-sm text-zinc-600">
        <Link href="/publisher/login" className="underline underline-offset-4">
          {t('loginTitle')}
        </Link>
      </p>
    </form>
  );
}
