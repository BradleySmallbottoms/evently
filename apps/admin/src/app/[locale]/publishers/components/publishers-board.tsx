'use client';

import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { MappingQueue } from './mapping-queue';
import { PublisherCatalog } from './publisher-catalog';
import { VerificationQueue } from '@/components/verification-queue';

function subscribe() {
  return () => {};
}

function hydratedOnClient() {
  return true;
}

function hydratedOnServer() {
  return false;
}

/** Server render and the hydration pass both report false. Cached queries render after that. */
function useHydrated() {
  return useSyncExternalStore(subscribe, hydratedOnClient, hydratedOnServer);
}

export function PublishersBoard() {
  const tApp = useTranslations('App');
  const hydrated = useHydrated();

  if (!hydrated) {
    return <Typography color="text.secondary">{tApp('loading')}</Typography>;
  }

  return (
    <Stack spacing={4}>
      <VerificationQueue />
      <MappingQueue />
      <PublisherCatalog />
    </Stack>
  );
}
