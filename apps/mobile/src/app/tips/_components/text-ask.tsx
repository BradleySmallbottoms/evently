import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { space } from '@/theme/tokens';

import type { Tip } from '@local-events/contracts';

import { LateReveal } from './chat-arrival';
import { Choice } from './choice';
import { ContentWarning } from './content-warning';
import { Composer } from './composer';
import { replyMatches } from './tip-answers';

export function TextAsk({
  prefix,
  icon,
  options,
  seed,
  answer,
  locked,
  onSend,
  onEdit,
  warning,
  onDismissWarning,
}: {
  prefix?: 'title' | 'place' | 'description';
  icon?: 'place';
  options: Tip['messages'][number]['options'];
  seed: string | null;
  answer: string | null;
  locked: boolean;
  onSend: (body: string) => void;
  onEdit: () => void;
  warning: string | null;
  onDismissWarning: () => void;
}) {
  const { t } = useTranslation();
  const parsed = answer?.match(/^(?:title|place|description):\s*(.+)$/i)?.[1] ?? null;
  const confirming = options.some((option) => option.reply?.startsWith('confirm:'));
  const [openInput, setOpenInput] = useState(parsed != null);
  const [value, setValue] = useState(parsed ?? '');

  useEffect(() => {
    if (parsed == null) return;
    setValue(parsed);
    setOpenInput(true);
  }, [parsed]);

  function send(text: string) {
    const next = text.trim().replace(/\s+/g, ' ');
    if (!next) return;
    onSend(prefix ? `${prefix}: ${next}` : next);
  }

  return (
    <View style={{ gap: space.lg, marginTop: space.sm }}>
      {confirming ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
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
                if (!value && seed) setValue(seed);
                onEdit();
              }}
            />
          ))}
        </View>
      ) : null}
      <LateReveal open={!confirming || openInput}>
        <View style={{ gap: space.lg }}>
          <Composer
            value={value}
            placeholder={t('tips.writePlaceholder')}
            editable={!locked}
            icon={icon}
            onChange={(next) => {
              setValue(next);
              if (warning) onDismissWarning();
            }}
            onFocus={onEdit}
          />
          {warning ? <ContentWarning key={warning} text={warning} /> : null}
          <PrimaryButton
            label={t('tips.send')}
            arrow
            disabled={locked || value.trim().length === 0}
            onPress={() => send(value)}
          />
        </View>
      </LateReveal>
    </View>
  );
}
