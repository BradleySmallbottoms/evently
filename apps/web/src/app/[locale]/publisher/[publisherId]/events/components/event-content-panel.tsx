'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, throwIfError } from '@/lib/api';

type Props = {
  eventId: string;
};

export function EventContentPanel({ eventId }: Props) {
  const t = useTranslations('Events');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      formEvent.currentTarget.reset();
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
    <Stack spacing={2}>
      <Typography variant="h6" component="h2">
        {t('contentTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('contentHelp')}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {list.isError && <Alert severity="error">{t('contentError')}</Alert>}
      <Stack component="form" onSubmit={create} spacing={1.5}>
        <TextField name="title" label={t('contentItemTitle')} required fullWidth size="small" />
        <TextField
          name="body"
          label={t('contentBody')}
          fullWidth
          size="small"
          multiline
          minRows={2}
        />
        <TextField name="kind" label={t('contentKind')} select defaultValue="info" size="small">
          <MenuItem value="info">{t('contentKindInfo')}</MenuItem>
          <MenuItem value="map">{t('contentKindMap')}</MenuItem>
          <MenuItem value="schedule">{t('contentKindSchedule')}</MenuItem>
          <MenuItem value="file">{t('contentKindFile')}</MenuItem>
        </TextField>
        <TextField
          name="visibility"
          label={t('contentVisibility')}
          select
          defaultValue="attendees"
          size="small"
        >
          <MenuItem value="attendees">{t('contentVisibilityAttendees')}</MenuItem>
          <MenuItem value="public">{t('contentVisibilityPublic')}</MenuItem>
        </TextField>
        <TextField
          name="s3Key"
          label={t('contentS3Key')}
          fullWidth
          size="small"
          helperText={t('contentS3KeyHelp')}
        />
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? t('contentAdding') : t('contentAdd')}
        </Button>
      </Stack>
      <Stack spacing={1}>
        {(list.data?.items ?? []).map((item) => (
          <Stack
            key={item.id}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="body2">
              {item.title} · {item.kind} · {item.visibility}
            </Typography>
            <Button size="small" color="error" onClick={() => void remove(item.id)}>
              {t('contentDelete')}
            </Button>
          </Stack>
        ))}
        {list.isSuccess && list.data.items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('contentEmpty')}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
