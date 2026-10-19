'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
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
import { Link, useRouter } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';
import { PublisherEvents } from './publisher-events';

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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<'org' | 'person'>('org');
  const [mode, setMode] = useState<'nothing' | 'plan'>('nothing');
  const [planId, setPlanId] = useState<MarketingPushPlanId>('single');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ['admin-publisher-events', publisherId],
    queryFn: () => adminFetch<{ total: number }>(`/publishers/${publisherId}/events`),
    retry: false,
  });
  const canDelete = events.data != null && events.data.total === 0;

  const remove = useMutation({
    mutationFn: () => adminFetch(`/publishers/${publisherId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setConfirmDelete(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-all'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-unverified'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-publishers-temporary'] });
      router.push('/publishers');
    },
    onError: () => {
      setConfirmDelete(false);
      setDeleteError(true);
    },
  });

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
    <Stack spacing={3}>
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
        <Stack spacing={3} component="form" onSubmit={onSubmit}>
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
          {deleteError ? <Alert severity="error">{t('deleteError')}</Alert> : null}
          <Stack direction="row" spacing={1}>
            <Button type="submit" variant="contained" disabled={save.isPending}>
              {save.isPending ? t('saving') : t('save')}
            </Button>
            {canDelete ? (
              <Button
                type="button"
                color="error"
                variant="outlined"
                disabled={remove.isPending}
                onClick={() => {
                  setDeleteError(false);
                  setConfirmDelete(true);
                }}
              >
                {remove.isPending ? t('deleting') : t('delete')}
              </Button>
            ) : null}
          </Stack>
        </Stack>
      ) : null}
      {current ? <PublisherEvents publisherId={publisherId} /> : null}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('deleteConfirm')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={() => setConfirmDelete(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t('delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
