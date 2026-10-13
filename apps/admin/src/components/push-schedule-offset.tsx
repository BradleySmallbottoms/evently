'use client';

import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { useTranslations } from 'next-intl';
import type { PushScheduleOffset } from '@local-events/domain';

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
    <FormControl fullWidth disabled={disabled}>
      <InputLabel id={`${id}-label`}>{t('scheduleOffset')}</InputLabel>
      <Select
        labelId={`${id}-label`}
        id={id}
        label={t('scheduleOffset')}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === 'week' || next === 'day' || next === 'hour' ? next : 'custom');
        }}
      >
        <MenuItem value="week">{t('offsetWeek')}</MenuItem>
        <MenuItem value="day">{t('offsetDay')}</MenuItem>
        <MenuItem value="hour">{t('offsetHour')}</MenuItem>
        <MenuItem value="custom">{t('offsetCustom')}</MenuItem>
      </Select>
    </FormControl>
  );
}
