'use client';

import {
  MARKETING_PUSH_PLANS,
  marketingPlanSteps,
  type MarketingPushPlanId,
  type PushScheduleOffset,
} from '@local-events/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { cn } from 'cn';
import { LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Link, useRouter } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';
import { PublisherAccounts } from './publisher-accounts';
import { PublisherEvents } from './publisher-events';

type Publisher = {
  id: string;
  name: string;
  slug: string;
  type: 'org' | 'person';
  status: 'pending_scan' | 'in_review' | 'published';
  importNotificationPlan: MarketingPushPlanId | null;
  importNotifyOnPublish: boolean;
};

const PLAN_LABEL = {
  single: 'planSingle',
  standard: 'planStandard',
  countdown: 'planCountdown',
  full: 'planFull',
} as const;

const OFFSET_LABEL: Record<PushScheduleOffset, 'offsetWeek' | 'offsetDay' | 'offsetHour'> = {
  week: 'offsetWeek',
  day: 'offsetDay',
  hour: 'offsetHour',
};

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
  const [notifyOnPublish, setNotifyOnPublish] = useState(false);
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
    setNotifyOnPublish(
      current.importNotifyOnPublish && current.importNotificationPlan !== 'single',
    );
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
          importNotifyOnPublish: mode === 'plan' && planId !== 'single' && notifyOnPublish,
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
      setNotifyOnPublish(
        updated.importNotifyOnPublish && updated.importNotificationPlan !== 'single',
      );
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
    const unauthorized = publisher.error instanceof AdminApiError && publisher.error.status === 401;
    const missing = publisher.error instanceof AdminApiError && publisher.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <Link href="/publishers" className={cn(buttonVariants({ variant: 'ghost' }), 'self-start')}>
          {t('back')}
        </Link>
        <Alert variant={unauthorized || missing ? 'default' : 'destructive'}>
          <AlertDescription>
            {unauthorized ? (
              <>
                {t('needLogin')} <Link href="/login">{tApp('navLogin')}</Link>
              </>
            ) : missing ? (
              t('notFound')
            ) : (
              t('loadError')
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/publishers" className={cn(buttonVariants({ variant: 'ghost' }), 'self-start')}>
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {publisher.isLoading ? <LoadingRows /> : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {current ? (
        <form onSubmit={onSubmit}>
          <Card>
            <CardContent className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="publisher-name">{t('name')}</FieldLabel>
                <Input
                  id="publisher-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="publisher-slug">{t('slug')}</FieldLabel>
                <Input
                  id="publisher-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="publisher-type">{t('type')}</FieldLabel>
                <Select
                  value={type}
                  onValueChange={(next) => {
                    if (next != null) setType(next);
                  }}
                >
                  <SelectTrigger id="publisher-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="org">{t('typeOrg')}</SelectItem>
                      <SelectItem value="person">{t('typePerson')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <p className="text-sm text-muted-foreground">
                {current.status === 'pending_scan'
                  ? t('statusPendingScan')
                  : current.status === 'published'
                    ? t('statusPublished')
                    : t('statusInReview')}
              </p>
              <h2 className="text-lg font-semibold">{t('settings')}</h2>
              <FieldSet>
                <FieldLegend variant="label">{t('notificationSettings')}</FieldLegend>
                <FieldDescription>{t('notificationLead')}</FieldDescription>
                <RadioGroup value={mode} onValueChange={(next) => setMode(next)}>
                  <Field orientation="horizontal">
                    <RadioGroupItem value="nothing" id="publisher-notify-nothing" />
                    <FieldLabel htmlFor="publisher-notify-nothing">
                      {t('notificationNothing')}
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem value="plan" id="publisher-notify-plan" />
                    <FieldLabel htmlFor="publisher-notify-plan">{t('notificationPlan')}</FieldLabel>
                  </Field>
                </RadioGroup>
              </FieldSet>
              {mode === 'plan' ? (
                <FieldSet>
                  <FieldLegend variant="label">{t('plan')}</FieldLegend>
                  <RadioGroup
                    value={planId}
                    onValueChange={(next) => {
                      if (
                        next === 'single' ||
                        next === 'standard' ||
                        next === 'countdown' ||
                        next === 'full'
                      ) {
                        setPlanId(next);
                      }
                    }}
                  >
                    {MARKETING_PUSH_PLANS.map((plan) => (
                      <div key={plan.id} className="flex flex-col gap-1">
                        <Field orientation="horizontal">
                          <RadioGroupItem value={plan.id} id={`publisher-plan-${plan.id}`} />
                          <FieldLabel htmlFor={`publisher-plan-${plan.id}`}>
                            {tPlans(PLAN_LABEL[plan.id])}
                          </FieldLabel>
                        </Field>
                        <ul className="ms-6 flex list-disc flex-col gap-1 text-sm text-muted-foreground">
                          {marketingPlanSteps(plan.id, planId !== 'single' && notifyOnPublish).map(
                            (step) => (
                              <li key={step}>
                                {step === 'published'
                                  ? tPlans('offsetPublished')
                                  : tPlans(OFFSET_LABEL[step])}
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    ))}
                  </RadioGroup>
                </FieldSet>
              ) : null}
              {mode === 'plan' && planId !== 'single' ? (
                <Field orientation="horizontal">
                  <Checkbox
                    id="publisher-notify-on-publish"
                    checked={notifyOnPublish}
                    onCheckedChange={(checked) => setNotifyOnPublish(checked === true)}
                  />
                  <FieldLabel htmlFor="publisher-notify-on-publish">
                    {t('notifyOnPublish')}
                  </FieldLabel>
                </Field>
              ) : null}
              {mode === 'plan' ? (
                <p className="text-sm text-muted-foreground">
                  {current.status === 'published'
                    ? t('notificationVerified')
                    : t('notificationUnverified')}
                </p>
              ) : null}
              {deleteError ? (
                <Alert variant="destructive">
                  <AlertDescription>{t('deleteError')}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {save.isPending ? t('saving') : t('save')}
                </Button>
                {canDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      setDeleteError(false);
                      setConfirmDelete(true);
                    }}
                  >
                    {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
                    {remove.isPending ? t('deleting') : t('delete')}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}
      {current ? <PublisherAccounts publisherId={publisherId} /> : null}
      {current ? <PublisherEvents publisherId={publisherId} /> : null}
      <Dialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
