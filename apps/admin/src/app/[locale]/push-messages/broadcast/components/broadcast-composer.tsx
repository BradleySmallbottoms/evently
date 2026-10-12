'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

const styles: Record<string, SxProps<Theme>> = {
  root: { display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 720 },
  panel: { p: 2, display: 'flex', flexDirection: 'column', gap: 2 },
};

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
    <Box sx={styles.root}>
      <Button component={Link} href="/push-messages" size="small" sx={{ alignSelf: 'flex-start' }}>
        {t('back')}
      </Button>
      <Typography variant="h5">{t('broadcastTitle')}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t('broadcastHint')}
      </Typography>
      <Paper sx={styles.panel} variant="outlined">
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          label={t('titleSv')}
          value={titleSv}
          onChange={(e) => setTitleSv(e.target.value)}
          fullWidth
          required
        />
        <TextField
          label={t('bodySv')}
          value={bodySv}
          onChange={(e) => setBodySv(e.target.value)}
          fullWidth
          required
          multiline
          minRows={2}
        />
        <TextField
          label={t('titleEn')}
          value={titleEn}
          onChange={(e) => setTitleEn(e.target.value)}
          fullWidth
          required
        />
        <TextField
          label={t('bodyEn')}
          value={bodyEn}
          onChange={(e) => setBodyEn(e.target.value)}
          fullWidth
          required
          multiline
          minRows={2}
        />
        <FormControl>
          <FormLabel id="broadcast-audience-label">{t('audienceRule')}</FormLabel>
          <RadioGroup
            aria-labelledby="broadcast-audience-label"
            value={audience}
            onChange={(e) => setAudience(e.target.value as 'everyone' | 'tag_interest')}
          >
            <FormControlLabel
              value="everyone"
              control={<Radio />}
              label={t('audienceEveryone')}
            />
            <FormControlLabel
              value="tag_interest"
              control={<Radio />}
              label={t('audienceTagInterest')}
            />
          </RadioGroup>
        </FormControl>
        {audience === 'tag_interest' ? (
          <TextField
            select
            label={t('audienceTag')}
            value={audienceTagId}
            onChange={(e) => setAudienceTagId(e.target.value)}
            fullWidth
            required
            helperText={t('audienceTagHint')}
          >
            {(tags.data?.items ?? []).map((tag) => (
              <MenuItem key={tag.id} value={tag.id}>
                {tag.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <TextField
          label={t('sendAt')}
          type="datetime-local"
          value={sendAt}
          onChange={(e) => setSendAt(e.target.value)}
          fullWidth
          helperText={t('broadcastSendAtHint')}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            onClick={() => create.mutate()}
            disabled={!canSubmit}
          >
            {t('broadcastCreate')}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
