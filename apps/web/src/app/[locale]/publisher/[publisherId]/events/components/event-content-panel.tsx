'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { api, throwIfError } from '@/lib/api';

type Props = {
  eventId: string;
};

export function EventContentPanel({ eventId }: Props) {
  const t = useTranslations('Events');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const list = useQuery({
    queryKey: ['managed-content', eventId],
    queryFn: async () =>
      throwIfError(
        await api.GET('/manage/events/{eventId}/content', {
          params: { path: { eventId } },
        }),
      ),
    retry: false,
  });

  async function create(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(formEvent.currentTarget);
    try {
      throwIfError(
        await api.POST('/manage/events/{eventId}/content', {
          params: { path: { eventId } },
          body: {
            kind: String(data.get('kind') ?? 'info') as 'map' | 'schedule' | 'info' | 'file',
            title: String(data.get('title') ?? '').trim(),
            body: String(data.get('body') ?? '').trim() || null,
            visibility: String(data.get('visibility') ?? 'attendees') as 'public' | 'attendees',
            s3Key: String(data.get('s3Key') ?? '').trim() || null,
          },
        }),
      );
      setFormKey((key) => key + 1);
      await list.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('contentError'));
    } finally {
      setPending(false);
    }
  }

  async function remove(contentId: string) {
    setError(null);
    try {
      throwIfError(
        await api.DELETE('/manage/content/{contentId}', {
          params: { path: { contentId } },
        }),
      );
      await list.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('contentError'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-foreground">{t('contentTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('contentHelp')}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {list.isError && (
        <Alert variant="destructive">
          <AlertDescription>{t('contentError')}</AlertDescription>
        </Alert>
      )}
      <form key={formKey} onSubmit={create} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="content-title">{t('contentItemTitle')}</Label>
          <Input id="content-title" name="title" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="content-body">{t('contentBody')}</Label>
          <Textarea id="content-body" name="body" rows={2} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="content-kind">{t('contentKind')}</Label>
          <Select name="kind" defaultValue="info">
            <SelectTrigger id="content-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="info">{t('contentKindInfo')}</SelectItem>
              <SelectItem value="map">{t('contentKindMap')}</SelectItem>
              <SelectItem value="schedule">{t('contentKindSchedule')}</SelectItem>
              <SelectItem value="file">{t('contentKindFile')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="content-visibility">{t('contentVisibility')}</Label>
          <Select name="visibility" defaultValue="attendees">
            <SelectTrigger id="content-visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="attendees">{t('contentVisibilityAttendees')}</SelectItem>
              <SelectItem value="public">{t('contentVisibilityPublic')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="content-s3">{t('contentS3Key')}</Label>
          <Input id="content-s3" name="s3Key" />
          <p className="text-sm text-muted-foreground">{t('contentS3KeyHelp')}</p>
        </div>
        <Button type="submit" variant="brand" disabled={pending}>
          {pending ? t('contentAdding') : t('contentAdd')}
        </Button>
      </form>
      <div className="flex flex-col gap-2">
        {(list.data?.items ?? []).map((item) => (
          <div key={item.id} className="flex flex-row items-center justify-between gap-2">
            <p className="text-sm text-foreground">
              {item.title} · {item.kind} · {item.visibility}
            </p>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => void remove(item.id)}
            >
              {t('contentDelete')}
            </Button>
          </div>
        ))}
        {list.isSuccess && list.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('contentEmpty')}</p>
        )}
      </div>
    </div>
  );
}
