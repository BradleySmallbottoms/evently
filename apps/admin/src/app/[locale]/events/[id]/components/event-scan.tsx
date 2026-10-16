'use client';

import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';

function formatLlmOutput(value: unknown): string | null {
  if (value == null) return null;
  try {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      try {
        return JSON.stringify(JSON.parse(trimmed) as unknown, null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

export function EventScan({ output }: { output: unknown }) {
  const t = useTranslations('EventEditor');
  const formatted = formatLlmOutput(output);
  if (!formatted) {
    return <Typography color="text.secondary">{t('scanEmpty')}</Typography>;
  }
  return (
    <Paper
      variant="outlined"
      component="pre"
      sx={{
        p: 2,
        m: 0,
        overflow: 'auto',
        maxHeight: '70vh',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.8125rem',
        lineHeight: 1.5,
        whiteSpace: 'pre',
      }}
    >
      {formatted}
    </Paper>
  );
}
