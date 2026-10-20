'use client';

import { useTranslations } from 'next-intl';
import type { PushScheduleOffset } from '@local-events/domain';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type ScheduleOffsetChoice = PushScheduleOffset | 'custom';

export function PushScheduleOffsetSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: ScheduleOffsetChoice;
  onChange: (value: ScheduleOffsetChoice) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('PushMessages');
  return (
    <Field className="w-full">
      <FieldLabel htmlFor={id}>{t('scheduleOffset')}</FieldLabel>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next == null) return;
          onChange(next === 'week' || next === 'day' || next === 'hour' ? next : 'custom');
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="week">{t('offsetWeek')}</SelectItem>
            <SelectItem value="day">{t('offsetDay')}</SelectItem>
            <SelectItem value="hour">{t('offsetHour')}</SelectItem>
            <SelectItem value="custom">{t('offsetCustom')}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
