'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type EventWarning = {
  code: 'possible_duplicate';
  eventId: string;
  title: string;
  matchedOn: 'title' | 'event-link' | 'link' | 'id' | 'llm';
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

function WarningGlyph({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span role="img" aria-label={label} className="inline-flex shrink-0 text-amber-600" />
        }
      >
        <TriangleAlert className="size-4" aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Same mark as the review queue: a warning icon whose tooltip names the other event. */
export function EventWarningMark({ warnings }: { warnings: EventWarning[] | undefined }) {
  const t = useTranslations('Events');
  const label = warningLabel(warnings ?? [], (title) => t('warningPossibleDuplicate', { title }));
  if (!label) return null;
  return <WarningGlyph label={label} />;
}

/** Tag total for a list row. Zero tags keeps the warning icon beside the count. */
export function EventTagCount({ count }: { count: number }) {
  const t = useTranslations('Events');
  const none = count === 0;
  return (
    <div className="flex items-center gap-1">
      {none ? <WarningGlyph label={t('warningNoTags')} /> : null}
      <span className={none ? 'text-amber-600' : undefined}>{count}</span>
    </div>
  );
}
