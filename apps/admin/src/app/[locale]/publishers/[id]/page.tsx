import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { PublisherEditor } from './components/publisher-editor';

export default function PublisherPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
      <PublisherDetails params={params} />
    </Suspense>
  );
}

async function PublisherDetails({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <PublisherEditor publisherId={id} />;
}
