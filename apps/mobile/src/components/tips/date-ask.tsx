import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Tip } from '@local-events/contracts';

import { TipDatePicker } from '@/components/native/tip-date-picker';
import { PrimaryButton } from '@/components/ui/primary-button';
import { partsInZone, stampKey, type DayStamp } from '@/lib/calendar-range';
import { space } from '@/theme/tokens';

import { LateReveal } from './chat-arrival';
import { Choice } from './choice';
import { FieldRow } from './field-row';
import { parseDate, replyMatches } from './tip-answers';

function dayFromKey(value: string | null): DayStamp | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function DateAsk({
  prefix,
  options,
  answer,
  locked,
  locale,
  seedDay,
  onSend,
  onEdit,
}: {
  prefix: 'startDate' | 'endDate' | 'date';
  options: Tip['messages'][number]['options'];
  answer: string | null;
  locked: boolean;
  locale: string;
  seedDay: string | null;
  onSend: (body: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const parsed = parseDate(answer);
  const seeded = dayFromKey(seedDay);
  const opensInput = options.some((option) => option.reply == null);
  const [openInput, setOpenInput] = useState(parsed != null);
  const [date, setDate] = useState<DayStamp>(parsed ?? seeded ?? partsInZone(new Date()));
  const showField = options.length === 0 || !opensInput || openInput;
  const lone = options.length === 1 ? options[0] : null;

  useEffect(() => {
    const next = parseDate(answer);
    if (next) {
      setDate(next);
      setOpenInput(true);
    }
  }, [answer]);

  return (
    <View style={{ gap: space.lg, marginTop: space.lg }}>
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
      <LateReveal open={showField}>
        <View style={{ gap: space.lg }}>
          <FieldRow
            option={lone}
            selected={lone?.reply ? replyMatches(lone.reply, answer) : openInput}
            locked={locked}
            onPress={() => {
              if (!lone) return;
              if (lone.reply) {
                onSend(lone.reply);
                return;
              }
              setOpenInput(true);
              onEdit();
            }}
          >
            <TipDatePicker
              value={date}
              disabled={locked}
              locale={locale}
              onChange={(day) => {
                setDate(day);
                onEdit();
              }}
            />
          </FieldRow>
          {!locked ? (
            <PrimaryButton
              label={t('tips.send')}
              arrow
              disabled={locked}
              onPress={() => onSend(`${prefix}: ${stampKey(date)}`)}
            />
          ) : null}
        </View>
      </LateReveal>
      {!showField && lone ? (
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
