'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, throwIfError } from '@/lib/api';

const styles: Record<string, SxProps<Theme>> = {
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '2.5rem',
    letterSpacing: '0.35em',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  payload: {
    wordBreak: 'break-all',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.85rem',
  },
};

type Props = {
  eventId: string;
  published: boolean;
};

export function DigitalCodePanel({ eventId, published }: Props) {
  const t = useTranslations('Events');
  const [pendingStart, setPendingStart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const session = useQuery({
    queryKey: ['digital-code', eventId, tick],
    queryFn: async () =>
      throwIfError(
        await api.GET('/manage/events/{eventId}/digital-code', {
          params: { path: { eventId } },
        }),
      ),
    enabled: published,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.revealed || !data.slotEndsAt) return false;
      const ms = new Date(data.slotEndsAt).getTime() - Date.now();
      return Math.max(ms + 200, 5_000);
    },
  });

  useEffect(() => {
    if (!session.data?.slotEndsAt || !session.data.revealed) return;
    const ms = new Date(session.data.slotEndsAt).getTime() - Date.now() + 250;
    if (ms <= 0) {
      setTick((n) => n + 1);
      return;
    }
    const id = window.setTimeout(() => setTick((n) => n + 1), ms);
    return () => window.clearTimeout(id);
  }, [session.data?.slotEndsAt, session.data?.revealed, tick]);

  async function start() {
    setPendingStart(true);
    setError(null);
    try {
      throwIfError(
        await api.POST('/manage/events/{eventId}/digital-code/start', {
          params: { path: { eventId } },
        }),
      );
      setTick((n) => n + 1);
      await session.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('digitalCodeError'));
    } finally {
      setPendingStart(false);
    }
  }

  if (!published) {
    return (
      <Alert severity="info">{t('digitalCodePublishFirst')}</Alert>
    );
  }

  const live = session.data;

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h2">
        {t('digitalCodeTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('digitalCodeHelp')}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {session.isError && <Alert severity="error">{t('digitalCodeError')}</Alert>}
      {!live?.revealed ? (
        <Button variant="contained" onClick={start} disabled={pendingStart}>
          {pendingStart ? t('digitalCodeStarting') : t('digitalCodeStart')}
        </Button>
      ) : (
        <Stack spacing={1.5}>
          <Typography sx={styles.code} component="p" aria-live="polite">
            {live.code}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('digitalCodeRotates', { seconds: live.rotationS })}
          </Typography>
          {live.qrPayload && (
            <Typography sx={styles.payload} color="text.secondary">
              {live.qrPayload}
            </Typography>
          )}
          <Button variant="outlined" onClick={start} disabled={pendingStart}>
            {t('digitalCodeRefresh')}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
