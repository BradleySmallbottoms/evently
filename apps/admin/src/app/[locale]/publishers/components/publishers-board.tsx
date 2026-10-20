'use client';

import { useSyncExternalStore } from 'react';
import { LoadingRows } from '@/components/list-state';
import { VerificationQueue } from '@/components/verification-queue';
import { MappingQueue } from './mapping-queue';
import { PublisherCatalog } from './publisher-catalog';

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
  const hydrated = useHydrated();

  if (!hydrated) {
    return <LoadingRows />;
  }

  return (
    <div className="flex flex-col gap-8">
      <VerificationQueue />
      <MappingQueue />
      <PublisherCatalog />
    </div>
  );
}
