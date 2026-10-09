import Container from '@mui/material/Container';
import type { ContainerProps } from '@mui/material/Container';
import type { SxProps, Theme } from '@mui/material/styles';

const pageMainSx: SxProps<Theme> = {
  py: { xs: 4, md: 8 },
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  flexGrow: 1,
};

export function PageMain({ children, maxWidth = 'md', sx, ...props }: ContainerProps) {
  return (
    <Container
      component="main"
      maxWidth={maxWidth}
      sx={[pageMainSx, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      {...props}
    >
      {children}
    </Container>
  );
}
