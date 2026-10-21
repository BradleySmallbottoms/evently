import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Tip } from '@local-events/contracts';

import { TipTimePicker } from '@/components/native/tip-time-picker';
import { PrimaryButton } from '@/components/ui/primary-button';
import { nearestTipClock } from '@/lib/tip-clock';
import { space } from '@/theme/tokens';

import { Choice } from './choice';
import { parseClock, replyMatches } from './tip-answers';

export function TimeAsk({
  prefix,
  options,
  answer,
  locked,
  onSend,
  onEdit,
}: {
  prefix: 'startTime' | 'endTime';
  options: Tip['messages'][number]['options'];
  answer: string | null;
  locked: boolean;
  onSend: (body: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const [time, setTime] = useState(() => nearestTipClock(parseClock(answer)));
  const lone = options.length === 1 ? options[0] : null;

  useEffect(() => {
    if (answer && parseClock(answer)) setTime(nearestTipClock(parseClock(answer)));
  }, [answer]);

  return (
    <View style={{ gap: space.lg, marginTop: space.sm }}>
      {options.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {options.map((option, index) => (
            <Choice
              key={`${option.label}-${index}`}
              label={option.label}
              selected={option.reply ? replyMatches(option.reply, answer) : false}
              disabled={locked}
              onPress={() => {
                if (option.reply) onSend(option.reply);
              }}
            />
          ))}
        </View>
      ) : null}
      <TipTimePicker
        value={time}
        disabled={locked}
        hourLabel={t('tips.hour')}
        minuteLabel={t('tips.minute')}
        option={
          lone
            ? {
                label: lone.label,
                selected: lone.reply ? replyMatches(lone.reply, answer) : false,
                onPress: () => {
                  if (lone.reply) onSend(lone.reply);
                },
              }
            : null
        }
        onChange={(clock) => {
          setTime(clock);
          onEdit();
        }}
      />
      {!locked ? (
        <PrimaryButton
          label={t('tips.send')}
          arrow
          disabled={locked}
          onPress={() => onSend(`${prefix}: ${time}`)}
        />
      ) : null}
    </View>
  );
}
