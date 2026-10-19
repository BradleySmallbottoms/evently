'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { MARKETING_PUSH_PLANS, type MarketingPushPlanId } from '@local-events/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';

type Publisher = {
  id: string;
  name: string;
  slug: string;
  type: 'org' | 'person';
  status: 'pending_scan' | 'in_review' | 'published';
  importNotificationPlan: MarketingPushPlanId | null;
};

const PLAN_LABEL = {
  single: 'planSingle',
  standard: 'planStandard',
  countdown: 'planCountdown',
  full: 'planFull',
} as const;

export function PublisherEditor({ publisherId }: { publisherId: string }) {
  const t = useTranslations('PublisherEditor');
  const tPlans = useTranslations('PushMessages');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<'org' | 'person'>('org');
  const [mode, setMode] = useState<'nothing' | 'plan'>('nothing');
  const [planId, setPlanId] = useState<MarketingPushPlanId>('single');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publisher = useQuery({
    queryKey: ['admin-publisher', publisherId],
    queryFn: () => adminFetch<Publisher>(`/publishers/${publisherId}`),
    retry: false,
  });

  const current = publisher.data;
  if (current && loadedId !== current.id) {
    setLoadedId(current.id);
    setName(current.name);
    setSlug(current.slug);
    setType(current.type);
    setMode(current.importNotificationPlan ? 'plan' : 'nothing');
    setPlanId(current.importNotificationPlan ?? 'single');
  }

  const save = useMutation({
    mutationFn: () =>
      adminFetch<Publisher>(`/publishers/${publisherId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          slug,
          type,
          importNotificationPlan: mode === 'plan' ? planId : null,
        }),
      }),
    onSuccess: async (updated) => {
      setNotice(t('saved'));
      setError(null);
      setName(updated.name);
      setSlug(updated.slug);
      setType(updated.type);
      setMode(updated.importNotificationPlan ? 'plan' : 'nothing');
      setPlanId(updated.importNotificationPlan ?? 'single');
      await queryClient.invalidateQueries({ queryKey: ['admin-publisher', publisherId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
    },
    onError: () => {
      setNotice(null);
      setError(t('saveError'));
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    save.mutate();
  }

  if (publisher.isError) {
    const unauthorized =
      publisher.error instanceof AdminApiError && publisher.error.status === 401;
    const missing = publisher.error instanceof AdminApiError && publisher.error.status === 404;
    return (
      <Stack spacing={2}>
        <Button component={Link} href="/publishers" sx={{ alignSelf: 'flex-start' }}>
          {t('back')}
        </Button>
        <Alert severity={unauthorized || missing ? 'info' : 'error'}>
          {unauthorized ? (
            <>
              {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
            </>
          ) : missing ? (
            t('notFound')
          ) : (
            t('loadError')
          )}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={3} component="form" onSubmit={onSubmit}>
      <Button component={Link} href="/publishers" sx={{ alignSelf: 'flex-start' }}>
        {t('back')}
      </Button>
      <Typography variant="h4" component="h1">
        {t('title')}
      </Typography>
      {publisher.isLoading ? <Typography color="text.secondary">{tApp('loading')}</Typography> : null}
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {current ? (
        <>
          <TextField
            label={t('name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            fullWidth
          />
          <TextField
            label={t('slug')}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
            fullWidth
          />
          <TextField
            select
            label={t('type')}
            value={type}
            onChange={(event) => setType(event.target.value as 'org' | 'person')}
            fullWidth
          >
            <MenuItem value="org">{t('typeOrg')}</MenuItem>
            <MenuItem value="person">{t('typePerson')}</MenuItem>
          </TextField>
          <Typography color="text.secondary">
            {current.status === 'pending_scan'
              ? t('statusPendingScan')
              : current.status === 'published'
                ? t('statusPublished')
                : t('statusInReview')}
          </Typography>
          <Typography variant="h6" component="h2">
            {t('settings')}
          </Typography>
          <FormControl>
            <FormLabel>{t('notificationSettings')}</FormLabel>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
              {t('notificationLead')}
            </Typography>
            <RadioGroup
              value={mode}
              onChange={(event) => setMode(event.target.value as 'nothing' | 'plan')}
            >
              <FormControlLabel value="nothing" control={<Radio />} label={t('notificationNothing')} />
              <FormControlLabel value="plan" control={<Radio />} label={t('notificationPlan')} />
            </RadioGroup>
          </FormControl>
          {mode === 'plan' ? (
            <TextField
              select
              label={t('plan')}
              value={planId}
              onChange={(event) => setPlanId(event.target.value as MarketingPushPlanId)}
              fullWidth
            >
              {MARKETING_PUSH_PLANS.map((plan) => (
                <MenuItem key={plan.id} value={plan.id}>
                  {tPlans(PLAN_LABEL[plan.id])}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {mode === 'plan' ? (
            <Typography variant="body2" color="text.secondary">
              {current.status === 'published' ? t('notificationVerified') : t('notificationUnverified')}
            </Typography>
          ) : null}
          <Button type="submit" variant="contained" disabled={save.isPending} sx={{ alignSelf: 'flex-start' }}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </>
      ) : null}
    </Stack>
  );
}
