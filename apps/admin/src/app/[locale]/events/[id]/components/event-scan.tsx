'use client';

import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';
import { readScanView } from './scan-output';

const jsonSx: SxProps<Theme> = {
  p: 2,
  m: 0,
  overflow: 'auto',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8125rem',
  lineHeight: 1.5,
  whiteSpace: 'pre',
};

export function EventScan({ output }: { output: unknown }) {
  const t = useTranslations('EventEditor');
  const view = readScanView(output);
  if (!view) {
    return <Typography color="text.secondary">{t('scanEmpty')}</Typography>;
  }
  return (
    <Stack spacing={3}>
      {view.finalObject ? (
        <Stack spacing={1}>
          <Typography variant="h6" component="h2">
            {t('scanResult')}
          </Typography>
          <Paper variant="outlined" component="pre" sx={jsonSx}>
            {JSON.stringify(view.finalObject, null, 2)}
          </Paper>
        </Stack>
      ) : null}
      {view.reasoning ? (
        <Stack spacing={1}>
          <Typography variant="h6" component="h2">
            {t('scanReasoning')}
          </Typography>
          <Paper variant="outlined" sx={{ p: 2, whiteSpace: 'pre-wrap' }}>
            {view.reasoning}
          </Paper>
        </Stack>
      ) : null}
      <Stack spacing={1}>
        <Typography variant="h6" component="h2">
          {t('scanFull')}
        </Typography>
        <Paper variant="outlined" component="pre" sx={{ ...jsonSx, maxHeight: '70vh' }}>
          {view.full}
        </Paper>
      </Stack>
    </Stack>
  );
}
