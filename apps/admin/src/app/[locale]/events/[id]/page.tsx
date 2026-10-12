import Typography from '@mui/material/Typography';
import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { EventEditor } from './components/event-editor';

export default function EventPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  return (
    <Suspense fallback={<Typography color="text.secondary">…</Typography>}>
      <EventDetails params={params} />
    </Suspense>
  );
}

async function EventDetails({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <EventEditor eventId={id} />;
}
