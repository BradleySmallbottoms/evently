'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';

export function RegisterForm() {
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
      const result = await api.POST('/publishers/register', {
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="register-email">{t('email')}</Label>
        <Input id="register-email" name="email" type="email" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="register-password">{t('password')}</Label>
        <Input id="register-password" name="password" type="password" required minLength={10} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="register-name">{t('name')}</Label>
        <Input id="register-name" name="name" type="text" required minLength={2} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="publisher-type">{t('type')}</Label>
        <Select name="type" defaultValue="org">
          <SelectTrigger id="publisher-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="org">{t('typeOrg')}</SelectItem>
            <SelectItem value="person">{t('typePerson')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant="brand" disabled={pending}>
        {t('registerSubmit')}
      </Button>
      <p className="text-sm text-muted-foreground">
        <AppLink href="/publisher/login" className="underline-offset-4 hover:underline">
          {t('loginTitle')}
        </AppLink>
      </p>
    </form>
  );
}
