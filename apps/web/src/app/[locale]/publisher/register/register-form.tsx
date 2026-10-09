'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
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
            | 'org'
            | 'person',
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
    <Stack component="form" onSubmit={onSubmit} spacing={2}>
      <TextField name="email" type="email" label={t('email')} required fullWidth />
      <TextField
        name="password"
        type="password"
        label={t('password')}
        required
        fullWidth
        slotProps={{ htmlInput: { minLength: 10 } }}
      />
      <TextField
        name="name"
        type="text"
        label={t('name')}
        required
        fullWidth
        slotProps={{ htmlInput: { minLength: 2 } }}
      />
      <FormControl fullWidth>
        <InputLabel id="publisher-type-label">{t('type')}</InputLabel>
        <Select
          labelId="publisher-type-label"
          name="type"
          label={t('type')}
          defaultValue="org"
        >
          <MenuItem value="org">{t('typeOrg')}</MenuItem>
          <MenuItem value="person">{t('typePerson')}</MenuItem>
        </Select>
      </FormControl>
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" variant="contained" disabled={pending}>
        {t('registerSubmit')}
      </Button>
      <Typography variant="body2" color="text.secondary">
        <Link component={AppLink} href="/publisher/login" underline="hover">
          {t('loginTitle')}
        </Link>
      </Typography>
    </Stack>
  );
}
