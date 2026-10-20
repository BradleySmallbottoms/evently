'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { Link, useRouter } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

type TagOption = { id: string; name: string };

type PushMessage = {
  id: string;
  kind: string;
  audience: string;
  status: string;
};

export function BroadcastComposer() {
  const t = useTranslations('PushMessages');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [titleSv, setTitleSv] = useState('');
  const [bodySv, setBodySv] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'tag_interest'>('everyone');
  const [audienceTagId, setAudienceTagId] = useState('');
  const [sendAt, setSendAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tags = useQuery({
    queryKey: ['admin-tags'],
    queryFn: () => adminFetch<{ items: TagOption[] }>('/tags'),
  });

  const create = useMutation({
    mutationFn: () =>
      adminFetch<PushMessage>('/push-messages/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          titleSv,
          bodySv,
          titleEn,
          bodyEn,
          audience,
          ...(audience === 'tag_interest' ? { audienceTagId } : {}),
          sendAt: sendAt ? new Date(sendAt).toISOString() : null,
        }),
      }),
    onSuccess: async (row) => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-push-messages'] });
      router.push(`/push-messages/${row.id}`);
    },
    onError: () => setError(t('broadcastCreateError')),
  });

  const canSubmit =
    titleSv.trim() &&
    bodySv.trim() &&
    titleEn.trim() &&
    bodyEn.trim() &&
    (audience === 'everyone' || Boolean(audienceTagId)) &&
    !create.isPending;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link
        href="/push-messages"
        className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'self-start' })}
      >
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('broadcastTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('broadcastHint')}</p>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="broadcast-title-sv">{t('titleSv')}</FieldLabel>
            <Input
              id="broadcast-title-sv"
              value={titleSv}
              onChange={(event) => setTitleSv(event.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="broadcast-body-sv">{t('bodySv')}</FieldLabel>
            <Textarea
              id="broadcast-body-sv"
              value={bodySv}
              onChange={(event) => setBodySv(event.target.value)}
              required
              rows={2}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="broadcast-title-en">{t('titleEn')}</FieldLabel>
            <Input
              id="broadcast-title-en"
              value={titleEn}
              onChange={(event) => setTitleEn(event.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="broadcast-body-en">{t('bodyEn')}</FieldLabel>
            <Textarea
              id="broadcast-body-en"
              value={bodyEn}
              onChange={(event) => setBodyEn(event.target.value)}
              required
              rows={2}
            />
          </Field>
          <FieldSet>
            <FieldLegend variant="label" id="broadcast-audience-label">
              {t('audienceRule')}
            </FieldLegend>
            <RadioGroup
              aria-labelledby="broadcast-audience-label"
              value={audience}
              onValueChange={(next) => {
                if (next === 'everyone' || next === 'tag_interest') setAudience(next);
              }}
            >
              <Field orientation="horizontal">
                <RadioGroupItem value="everyone" id="broadcast-audience-everyone" />
                <FieldLabel htmlFor="broadcast-audience-everyone">
                  {t('audienceEveryone')}
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="tag_interest" id="broadcast-audience-tag" />
                <FieldLabel htmlFor="broadcast-audience-tag">{t('audienceTagInterest')}</FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet>
          {audience === 'tag_interest' ? (
            <Field>
              <FieldLabel htmlFor="broadcast-audience-tag-id">{t('audienceTag')}</FieldLabel>
              <Select
                value={audienceTagId || null}
                onValueChange={(next) => {
                  if (next != null) setAudienceTagId(next);
                }}
              >
                <SelectTrigger id="broadcast-audience-tag-id" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(tags.data?.items ?? []).map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{t('audienceTagHint')}</FieldDescription>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="broadcast-send-at">{t('sendAt')}</FieldLabel>
            <Input
              id="broadcast-send-at"
              type="datetime-local"
              value={sendAt}
              onChange={(event) => setSendAt(event.target.value)}
            />
            <FieldDescription>{t('broadcastSendAtHint')}</FieldDescription>
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => create.mutate()} disabled={!canSubmit}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('broadcastCreate')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
