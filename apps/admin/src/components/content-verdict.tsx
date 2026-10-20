'use client';

import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';

export type ContentVerdict = 'safe' | 'harmful' | 'spam' | 'unknown';

const VARIANTS = {
  safe: 'default',
  harmful: 'destructive',
  spam: 'outline',
  unknown: 'secondary',
} as const;

export function ContentVerdictChip({ verdict }: { verdict: ContentVerdict | undefined }) {
  const t = useTranslations('ContentVerdict');
  const value = verdict ?? 'unknown';
  return <Badge variant={VARIANTS[value]}>{t(value)}</Badge>;
}
