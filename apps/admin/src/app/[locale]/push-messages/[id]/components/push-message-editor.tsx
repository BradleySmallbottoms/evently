'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

type PushMessage = {
  id: string;
  eventId: string | null;
  eventTitle: string | null;
  publisherName: string | null;
  eventStatus: string | null;
  kind: string;
  audience: string;
  audienceTagName?: string | null;
  status: string;
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
  sendAt: string | null;
};

type Audience = {
  nearby: number;
  publisherFollowers: number;
  uniqueRecipients: number;
  withPushToken: number;
  capped: boolean;
  eventPublished: boolean;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PushMessageEditor({ pushMessageId }: { pushMessageId: string }) {
  const t = useTranslations('PushMessages');
  const id = pushMessageId;
  const queryClient = useQueryClient();
  const message = useQuery({
    queryKey: ['admin-push-message', id],
    queryFn: () => adminFetch<PushMessage>(`/push-messages/${id}`),
  });
  const audience = useQuery({
    queryKey: ['admin-push-audience', id],
    queryFn: () => adminFetch<Audience>(`/push-messages/${id}/audience`),
  });

  const [titleSv, setTitleSv] = useState('');
  const [bodySv, setBodySv] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [sendAt, setSendAt] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!message.data) return;
    setTitleSv(message.data.titleSv);
    setBodySv(message.data.bodySv);
    setTitleEn(message.data.titleEn);
    setBodyEn(message.data.bodyEn);
    setSendAt(toLocalInput(message.data.sendAt));
  }, [message.data]);

  const save = useMutation({
    mutationFn: () =>
      adminFetch<PushMessage>(`/push-messages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          titleSv,
          bodySv,
          titleEn,
          bodyEn,
          sendAt: sendAt ? new Date(sendAt).toISOString() : null,
        }),
      }),
    onSuccess: async () => {
      setNotice(t('saved'));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-message', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
    },
    onError: () => setError(t('saveError')),
  });

  const approve = useMutation({
    mutationFn: () =>
      adminFetch<PushMessage>(`/push-messages/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          sendAt: sendAt ? new Date(sendAt).toISOString() : null,
        }),
      }),
    onSuccess: async () => {
      setNotice(t('approved'));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-message', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-audience', id] });
    },
    onError: () => setError(t('approveError')),
  });

  const reject = useMutation({
    mutationFn: () => adminFetch<PushMessage>(`/push-messages/${id}/reject`, { method: 'POST' }),
    onSuccess: async () => {
      setNotice(t('rejected'));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-message', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
    },
    onError: () => setError(t('rejectError')),
  });

  if (message.isLoading) {
    return <LoadingRows />;
  }
  if (message.isError || !message.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('loadError')}</AlertDescription>
      </Alert>
    );
  }

  const editable =
    message.data.status === 'pending' ||
    message.data.status === 'approved' ||
    message.data.status === 'rejected';

  const summary =
    message.data.kind === 'broadcast'
      ? `${t('kindBroadcast')} · ${
          message.data.audience === 'tag_interest'
            ? t('audienceTagLabel', { tag: message.data.audienceTagName ?? '—' })
            : t('audienceEveryone')
        } · ${message.data.status}`
      : `${message.data.eventTitle ?? '—'} · ${message.data.publisherName ?? '—'} · ${
          message.data.audience === 'area'
            ? t('audienceArea')
            : message.data.audience === 'area_and_tag'
              ? t('audienceAreaAndTag')
              : t('audienceEventMatch')
        } · ${message.data.status}`;

  return (
    <div className="grid items-start gap-6 md:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <Link
            href="/push-messages"
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'self-start' })}
          >
            {t('back')}
          </Link>
          <CardTitle className="text-2xl font-semibold">{t('editorTitle')}</CardTitle>
          <CardDescription>{summary}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
          <Field>
            <FieldLabel htmlFor="push-title-sv">{t('titleSv')}</FieldLabel>
            <Input
              id="push-title-sv"
              value={titleSv}
              onChange={(event) => setTitleSv(event.target.value)}
              disabled={!editable}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="push-body-sv">{t('bodySv')}</FieldLabel>
            <Textarea
              id="push-body-sv"
              value={bodySv}
              onChange={(event) => setBodySv(event.target.value)}
              disabled={!editable}
              rows={2}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="push-title-en">{t('titleEn')}</FieldLabel>
            <Input
              id="push-title-en"
              value={titleEn}
              onChange={(event) => setTitleEn(event.target.value)}
              disabled={!editable}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="push-body-en">{t('bodyEn')}</FieldLabel>
            <Textarea
              id="push-body-en"
              value={bodyEn}
              onChange={(event) => setBodyEn(event.target.value)}
              disabled={!editable}
              rows={2}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="push-send-at">{t('sendAt')}</FieldLabel>
            <Input
              id="push-send-at"
              type="datetime-local"
              value={sendAt}
              onChange={(event) => setSendAt(event.target.value)}
              disabled={!editable}
            />
            <FieldDescription>
              {message.data.kind === 'broadcast' ? t('broadcastSendAtHint') : t('sendAtHint')}
            </FieldDescription>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={!editable || save.isPending}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('save')}
            </Button>
            {message.data.kind !== 'broadcast' ? (
              <Button onClick={() => approve.mutate()} disabled={!editable || approve.isPending}>
                {approve.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('approve')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => reject.mutate()}
              disabled={!editable || reject.isPending}
            >
              {reject.isPending ? <Spinner data-icon="inline-start" /> : null}
              {message.data.kind === 'broadcast' ? t('cancelBroadcast') : t('reject')}
            </Button>
            {message.data.eventId ? (
              <Link
                href={`/events/${message.data.eventId}`}
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                {t('openEvent')}
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">{t('audienceTitle')}</CardTitle>
          <CardDescription>{t('audienceHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {message.data.kind !== 'broadcast' && !audience.data?.eventPublished ? (
            <Alert>
              <AlertDescription>{t('notPublished')}</AlertDescription>
            </Alert>
          ) : null}
          {audience.isLoading ? (
            <LoadingRows />
          ) : audience.data ? (
            <>
              {message.data.kind === 'broadcast' ? null : (
                <>
                  <div className="flex justify-between gap-4">
                    <p className="text-sm">
                      {message.data.audience === 'area'
                        ? t('audienceArea')
                        : message.data.audience === 'area_and_tag'
                          ? t('audienceAreaAndTag')
                          : t('statNearby')}
                    </p>
                    <p className="text-sm font-semibold">{audience.data.nearby}</p>
                  </div>
                  <div className="flex justify-between gap-4">
                    <p className="text-sm">{t('statFollowers')}</p>
                    <p className="text-sm font-semibold">{audience.data.publisherFollowers}</p>
                  </div>
                </>
              )}
              <div className="flex justify-between gap-4">
                <p className="text-sm">{t('statUnique')}</p>
                <p className="text-sm font-semibold">{audience.data.uniqueRecipients}</p>
              </div>
              <div className="flex justify-between gap-4">
                <p className="text-sm">{t('statTokens')}</p>
                <p className="text-sm font-semibold">{audience.data.withPushToken}</p>
              </div>
              {audience.data.capped ? (
                <Alert>
                  <AlertDescription>{t('capped')}</AlertDescription>
                </Alert>
              ) : null}
              <p className="text-xs text-muted-foreground">{t('aggregateNote')}</p>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void audience.refetch()}
            disabled={audience.isFetching}
          >
            {audience.isFetching ? <Spinner data-icon="inline-start" /> : null}
            {t('refreshAudience')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
