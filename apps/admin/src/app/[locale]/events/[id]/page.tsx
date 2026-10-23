import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { EventEditor } from './components/event-editor';

export const instant = false;

export default function EventPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
      <EventDetails params={params} />
    </Suspense>
  );
}

async function EventDetails({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <EventEditor eventId={id} />;
}
