'use client';

import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AppLink } from '@/components/app-link';
import { api, throwIfError } from '@/lib/api';
import { QueryProvider } from '@/lib/query-provider';
import { LogoutButton } from './logout-button';

function WorkspaceInner() {
  const t = useTranslations('Publisher');
  const me = useQuery({
    queryKey: ['publisher-me'],
    queryFn: async () => throwIfError(await api.GET('/publishers/me')),
    retry: false,
  });

  if (me.isPending) {
    return (
      <Typography variant="body2" color="text.secondary">
        …
      </Typography>
    );
  }

  if (me.isError || !me.data) {
    return (
      <Stack spacing={1.5}>
        <Typography color="text.secondary">{t('errorCredentials')}</Typography>
        <Link component={AppLink} href="/publisher/login" underline="hover">
          {t('loginTitle')}
        </Link>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Typography color="text.secondary">{t('welcome', { email: me.data.email })}</Typography>
        <LogoutButton />
      </Stack>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          {t('yourPublishers')}
        </Typography>
        <List disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {me.data.publishers.map((p) => (
            <ListItem
              key={p.id}
              divider
              secondaryAction={
                <Link
                  component={AppLink}
                  href={`/publisher/${p.id}/events`}
                  underline="hover"
                  variant="body2"
                >
                  {t('manageEvents')}
                </Link>
              }
            >
              <ListItemText primary={p.name} secondary={`${p.slug} · ${p.role}`} />
            </ListItem>
          ))}
        </List>
      </Stack>
    </Stack>
  );
}

export function WorkspacePanel() {
  return (
    <QueryProvider>
      <WorkspaceInner />
    </QueryProvider>
  );
}
