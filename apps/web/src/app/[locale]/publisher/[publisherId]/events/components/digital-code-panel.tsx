'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api, throwIfError } from '@/lib/api';

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
      const id = window.setTimeout(() => setTick((n) => n + 1), 0);
      return () => window.clearTimeout(id);
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
      <Alert>
        <AlertDescription>{t('digitalCodePublishFirst')}</AlertDescription>
      </Alert>
    );
  }

  const live = session.data;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-foreground">{t('digitalCodeTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('digitalCodeHelp')}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {session.isError && (
        <Alert variant="destructive">
          <AlertDescription>{t('digitalCodeError')}</AlertDescription>
        </Alert>
      )}
      {!live?.revealed ? (
        <Button type="button" variant="brand" onClick={start} disabled={pendingStart}>
          {pendingStart ? t('digitalCodeStarting') : t('digitalCodeStart')}
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <p
            className="font-mono text-4xl font-bold tracking-[0.35em] text-foreground"
            aria-live="polite"
          >
            {live.code}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('digitalCodeRotates', { seconds: live.rotationS })}
          </p>
          {live.qrPayload && (
            <p className="font-mono text-sm break-all text-muted-foreground">{live.qrPayload}</p>
          )}
          <Button type="button" variant="outline" onClick={start} disabled={pendingStart}>
            {t('digitalCodeRefresh')}
          </Button>
        </div>
      )}
    </div>
  );
}
