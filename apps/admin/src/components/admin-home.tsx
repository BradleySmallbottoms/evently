import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

const styles: Record<string, SxProps<Theme>> = {
  main: {
    py: { xs: 4, md: 8 },
    flexGrow: 1,
    display: 'flex',
    alignItems: 'center',
  },
  mono: {
    fontFamily: 'ui-monospace, monospace',
  },
};

export function AdminHome({
  name,
  tagline,
  apiUrl,
}: {
  name: string;
  tagline: string;
  apiUrl: string;
}) {
  return (
    <Container component="main" maxWidth="md" sx={styles.main}>
      <Stack spacing={2}>
        <Typography variant="h3" component="h1">
          {name}
        </Typography>
        <Typography color="text.secondary">{tagline}</Typography>
        <Typography variant="caption" sx={styles.mono}>
          {apiUrl}
        </Typography>
      </Stack>
    </Container>
  );
}
