'use client';

import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { adminFetch } from '@/lib/api';

const styles: Record<string, SxProps<Theme>> = {
  main: {
    py: 3,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    flexGrow: 1,
    fontWeight: 600,
  },
};

type Me = { adminId: string; email: string; role: string; expiresAt: string };

export function AdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('App');
  const router = useRouter();
  const me = useQuery({
    queryKey: ['admin-me'],
    queryFn: () => adminFetch<Me>('/admin/me'),
    retry: false,
  });

  async function logout() {
    await adminFetch('/admin/logout', { method: 'POST' });
    await me.refetch();
    router.push('/login');
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar>
          <Typography
            component={Link}
            href="/"
            variant="h6"
            color="inherit"
            sx={{ ...styles.title, textDecoration: 'none' }}
          >
            {t('name')}
          </Typography>
          {me.data ? (
            <>
              <Button component={Link} href="/publishers" color="inherit">
                {t('navPublishers')}
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ mx: 1 }}>
                {me.data.email}
              </Typography>
              <Button color="inherit" onClick={() => void logout()}>
                {t('logout')}
              </Button>
            </>
          ) : (
            <Button component={Link} href="/login" color="inherit">
              {t('navLogin')}
            </Button>
          )}
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="lg" sx={styles.main}>
        {children}
      </Container>
    </Box>
  );
}
