'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { AdminApiError, adminFetch } from '@/lib/api';

type Props = {
  eventId: string;
  posterUrl: string | null;
};

/** Uploads or removes the sponsored poster immediately. The sponsored switch is saved with the form. */
export function EventPoster({ eventId, posterUrl }: Props) {
  const t = useTranslations('EventEditor');
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null | undefined>(undefined);
  const shownUrl = previewUrl === undefined ? posterUrl : previewUrl;

  async function refresh(nextUrl: string | null) {
    setPreviewUrl(nextUrl);
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ['admin-event', eventId] });
  }

  const upload = useMutation({
    mutationFn: (file: File) =>
      adminFetch<{ posterUrl: string | null }>(`/events/${eventId}/poster`, {
        method: 'POST',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      }),
    onSuccess: (saved) => refresh(saved.posterUrl),
    onError: (err: unknown) => {
      setError(err instanceof AdminApiError ? err.message : t('posterError'));
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      adminFetch<{ posterUrl: null }>(`/events/${eventId}/poster`, { method: 'DELETE' }),
    onSuccess: () => refresh(null),
    onError: (err: unknown) => {
      setError(err instanceof AdminApiError ? err.message : t('posterRemoveError'));
    },
  });
  const busy = upload.isPending || remove.isPending;

  return (
    <Field>
      <FieldLabel htmlFor="event-poster">{t('poster')}</FieldLabel>
      <FieldDescription>{t('posterHint')}</FieldDescription>
      {shownUrl ? (
        <img src={shownUrl} alt={t('poster')} className="mt-2 max-h-64 rounded-lg object-contain" />
      ) : null}
      <input
        ref={fileRef}
        id="event-poster"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) upload.mutate(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {shownUrl ? t('posterReplace') : t('posterUpload')}
        </Button>
        {shownUrl ? (
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => remove.mutate()}
          >
            {t('posterRemove')}
          </Button>
        ) : null}
      </div>
      {upload.isPending ? <FieldDescription>{t('posterUploading')}</FieldDescription> : null}
      {remove.isPending ? <FieldDescription>{t('posterRemoving')}</FieldDescription> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </Field>
  );
}
