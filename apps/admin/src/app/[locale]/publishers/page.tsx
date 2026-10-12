import Stack from '@mui/material/Stack';
import { setRequestLocale } from 'next-intl/server';
import { MappingQueue } from './components/mapping-queue';
import { PublisherCatalog } from './components/publisher-catalog';
import { VerificationQueue } from './components/verification-queue';

export default async function PublishersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Stack spacing={4}>
      <VerificationQueue />
      <MappingQueue />
      <PublisherCatalog />
    </Stack>
  );
}
