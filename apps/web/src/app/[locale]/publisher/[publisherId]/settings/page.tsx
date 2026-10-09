'use client';

import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { QueryProvider } from '@/lib/query-provider';
import { PublisherSettingsPanel } from './components/publisher-settings-panel';

export default function PublisherSettingsPage() {
  const t = useTranslations('Publisher');
  const nav = useTranslations('Nav');
  const params = useParams<{ publisherId: string }>();

  return (
    <PageMain maxWidth="sm">
      <Stack spacing={1}>
        <Link
          component={AppLink}
          href="/publisher"
          underline="hover"
          variant="body2"
          color="text.secondary"
        >
          {nav('workspace')}
        </Link>
        <Link
          component={AppLink}
          href={`/publisher/${params.publisherId}/events`}
          underline="hover"
          variant="body2"
          color="text.secondary"
        >
          {t('manageEvents')}
        </Link>
        <Typography variant="h4" component="h1">
          {t('settingsTitle')}
        </Typography>
      </Stack>
      <QueryProvider>
        <PublisherSettingsPanel />
      </QueryProvider>
    </PageMain>
  );
}
