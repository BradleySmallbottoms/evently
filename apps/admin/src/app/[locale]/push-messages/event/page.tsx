import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { EventPushComposer } from './components/event-push-composer';

export const instant = false;

export default function EventPushPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
      <EventPushDetails params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventPushDetails({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string }>;
}) {
  const { locale } = await params;
  const { eventId } = await searchParams;
  setRequestLocale(locale);
  return <EventPushComposer initialEventId={eventId} />;
}
