'use client';

import Chip from '@mui/material/Chip';
import { useTranslations } from 'next-intl';

export type ContentVerdict = 'safe' | 'harmful' | 'spam' | 'unknown';

const COLORS = {
  safe: 'success',
  harmful: 'error',
  spam: 'warning',
  unknown: 'default',
} as const;

export function ContentVerdictChip({ verdict }: { verdict: ContentVerdict | undefined }) {
  const t = useTranslations('ContentVerdict');
  const value = verdict ?? 'unknown';
  return <Chip size="small" color={COLORS[value]} label={t(value)} />;
}
