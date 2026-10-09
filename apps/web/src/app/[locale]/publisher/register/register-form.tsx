'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';

export function RegisterForm() {
  const t = useTranslations('Publisher');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await api.POST('/v1/publishers/register', {
        body: {
          email: String(formData.get('email') ?? ''),
          password: String(formData.get('password') ?? ''),
          name: String(formData.get('name') ?? ''),
          type: (String(formData.get('type') ?? 'org') === 'person' ? 'person' : 'org') as
            'org' | 'person',
        },
      });
      const data = throwIfError(result);
      const token = data.verificationToken
        ? `?token=${encodeURIComponent(data.verificationToken)}`
        : '';
      router.push(`/publisher/verify${token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
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
          minLength={10}
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('name')}</span>
        <input
          name="name"
          type="text"
          required
          minLength={2}
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('type')}</span>
        <select name="type" className="rounded border border-zinc-300 bg-white px-3 py-2">
          <option value="org">{t('typeOrg')}</option>
          <option value="person">{t('typePerson')}</option>
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t('registerSubmit')}
      </button>
      <p className="text-sm text-zinc-600">
        <Link href="/publisher/login" className="underline underline-offset-4">
          {t('loginTitle')}
        </Link>
      </p>
    </form>
  );
}
