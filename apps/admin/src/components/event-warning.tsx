'use client';

import Box from '@mui/material/Box';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';
import { useTranslations } from 'next-intl';

export type EventWarning = {
  code: 'possible_duplicate';
  eventId: string;
  title: string;
  matchedOn: 'title' | 'event-link' | 'link' | 'id';
};

function warningLabel(warnings: EventWarning[], labelFor: (title: string) => string): string {
  return warnings
    .map((warning) => {
      switch (warning.code) {
        case 'possible_duplicate':
          return labelFor(warning.title);
      }
    })
    .join(' ');
}

/** Same mark as the review queue: a warning icon whose tooltip names the other event. */
export function EventWarningMark({ warnings }: { warnings: EventWarning[] | undefined }) {
  const t = useTranslations('Events');
  const label = warningLabel(warnings ?? [], (title) => t('warningPossibleDuplicate', { title }));
  if (!label) return null;
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        role="img"
        aria-label={label}
        sx={{ display: 'inline-flex', color: 'warning.main', flexShrink: 0 }}
      >
        <SvgIcon fontSize="small" aria-hidden>
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
        </SvgIcon>
      </Box>
    </Tooltip>
  );
}
