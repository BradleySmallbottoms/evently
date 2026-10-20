'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AppLink } from '@/components/app-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { api, throwIfError } from '@/lib/api';
import { ManagedEventFields, readManagedEventForm, type EventMode } from './managed-event-fields';

const textLinkClass = 'text-sm underline-offset-4 hover:underline';

export function NewEventForm() {
  const t = useTranslations('Events');
  const router = useRouter();
  const { publisherId } = useParams<{ publisherId: string }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<EventMode>('physical');

  const categories = useQuery({
    queryKey: ['tags'],
    queryFn: async () => throwIfError(await api.GET('/tags')),
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const fields = readManagedEventForm(new FormData(event.currentTarget));
      const result = await api.POST('/publishers/{publisherId}/events', {
        params: { path: { publisherId } },
        body: {
          title: fields.title,
          description: fields.description || undefined,
          mode: fields.mode,
          startsAt: new Date(fields.startsAt).toISOString(),
          endsAt: new Date(fields.endsAt).toISOString(),
          timezone: fields.timezone,
          venueName: fields.venueName || undefined,
          location: fields.location,
          geofenceRadiusM: fields.geofenceRadiusM,
          onlineUrl: fields.onlineUrl,
          tagIds: fields.tagIds,
        },
      });
      const created = throwIfError(result);
      router.push(`/publisher/${publisherId}/events/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('newEvent')}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <ManagedEventFields
          mode={mode}
          onModeChange={setMode}
          categories={categories.data?.items}
          categoriesLoading={categories.isPending}
          categoriesError={categories.isError}
          categoriesInputId="categories"
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-row items-center gap-4">
          <Button type="submit" variant="brand" disabled={pending}>
            {t('createDraft')}
          </Button>
          <AppLink href={`/publisher/${publisherId}/events`} className={textLinkClass}>
            {t('backToEvents')}
          </AppLink>
        </div>
      </form>
    </div>
  );
}
