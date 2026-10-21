import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Tip } from '@local-events/contracts';

import { TipDatePicker } from '@/components/native/tip-date-picker';
import { TipTimePicker } from '@/components/native/tip-time-picker';
import { PrimaryButton } from '@/components/ui/primary-button';
import { partsInZone, stampKey, type DayStamp } from '@/lib/calendar-range';
import { nearestTipClock } from '@/lib/tip-clock';
import { space } from '@/theme/tokens';

import { Choice } from './choice';
import { parseEnd, replyMatches } from './tip-answers';

export function EndAsk({
  options,
  answer,
  locked,
  locale,
  onSend,
  onEdit,
}: {
  options: Tip['messages'][number]['options'];
  answer: string | null;
  locked: boolean;
  locale: string;
  onSend: (body: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const parsed = parseEnd(answer);
  const opensInput = options.some((option) => option.reply == null);
  const [openInput, setOpenInput] = useState(Boolean(parsed.date || parsed.time));
  const [date, setDate] = useState<DayStamp>(parsed.date ?? partsInZone(new Date()));
  const [time, setTime] = useState(nearestTipClock(parsed.time));
  const showField = !opensInput || openInput;
  const lone = options.length === 1 ? options[0] : null;

  useEffect(() => {
    if (!answer) return;
    const next = parseEnd(answer);
    if (next.date) setDate(next.date);
    if (next.time) setTime(nearestTipClock(next.time));
    if (next.date || next.time) setOpenInput(true);
  }, [answer]);

  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      {options.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {options.map((option, index) => (
            <Choice
              key={`${option.label}-${index}`}
              label={option.label}
              selected={option.reply ? replyMatches(option.reply, answer) : openInput}
              disabled={locked}
              onPress={() => {
                if (option.reply) {
                  onSend(option.reply);
                  return;
                }
                setOpenInput(true);
                onEdit();
              }}
            />
          ))}
        </View>
      ) : null}
      {showField ? (
        <>
          <TipDatePicker
            value={date}
            disabled={locked}
            locale={locale}
            onChange={(day) => {
              setDate(day);
              onEdit();
            }}
          />
          <TipTimePicker
            value={time}
            disabled={locked}
            hourLabel={t('tips.hour')}
            minuteLabel={t('tips.minute')}
            option={
              lone
                ? {
                    label: lone.label,
                    selected: lone.reply ? replyMatches(lone.reply, answer) : openInput,
                    onPress: () => {
                      if (lone.reply) {
                        onSend(lone.reply);
                        return;
                      }
                      setOpenInput(true);
                      onEdit();
                    },
                  }
                : null
            }
            onChange={(clock) => {
              setTime(clock);
              onEdit();
            }}
          />
          <PrimaryButton
            label={t('tips.send')}
            arrow
            disabled={locked}
            onPress={() => onSend(`end: ${stampKey(date)} ${time}`)}
          />
        </>
      ) : lone ? (
        <Choice
          label={lone.label}
          selected={lone.reply ? replyMatches(lone.reply, answer) : openInput}
          disabled={locked}
          onPress={() => {
            if (lone.reply) {
              onSend(lone.reply);
              return;
            }
            setOpenInput(true);
            onEdit();
          }}
        />
      ) : null}
    </View>
  );
}
