import Typography from '@mui/material/Typography';
import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { PushMessageEditor } from './components/push-message-editor';

export default function PushMessageDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  return (
    <Suspense fallback={<Typography color="text.secondary">…</Typography>}>
      <PushMessageDetails params={params} />
    </Suspense>
  );
}

async function PushMessageDetails({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <PushMessageEditor pushMessageId={id} />;
}
