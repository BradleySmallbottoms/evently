import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

import type { Tip } from '@local-events/contracts';

import { LateReveal } from './chat-arrival';
import { Choice } from './choice';
import { Composer } from './composer';
import { parsePrice, replyMatches } from './tip-answers';

function seedPrice(label: string | null): { choice: 'free' | 'paid' | null; amount: string } {
  if (!label) return { choice: null, amount: '' };
  if (/gratis|free/i.test(label)) return { choice: 'free', amount: '' };
  const amount = label.match(/(\d{1,6}(?:[.,]\d{1,2})?)/);
  return amount?.[1] ? { choice: 'paid', amount: amount[1] } : { choice: null, amount: '' };
}

export function PriceAsk({
  options,
  seed,
  answer,
  locked,
  onSend,
  onEdit,
}: {
  options: Tip['messages'][number]['options'];
  seed: string | null;
  answer: string | null;
  locked: boolean;
  onSend: (body: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const parsed = parsePrice(answer);
  const confirming = options.some((option) => option.reply?.startsWith('confirm:'));
  const seeded = seedPrice(seed);
  const [openInput, setOpenInput] = useState(parsed.choice != null);
  const [choice, setChoice] = useState<'free' | 'paid' | null>(
    parsed.choice ?? (confirming ? null : seeded.choice),
  );
  const [amount, setAmount] = useState(parsed.amount || (confirming ? '' : seeded.amount));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!answer) return;
    const next = parsePrice(answer);
    setChoice(next.choice);
    setAmount(next.amount);
  }, [answer]);

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
                const seeded = seedPrice(seed);
                setOpenInput(true);
                if (!choice && seeded.choice) {
                  setChoice(seeded.choice);
                  setAmount(seeded.amount);
                }
                onEdit();
              }}
            />
          ))}
        </View>
      ) : null}
      <LateReveal open={!confirming || openInput}>
        <View style={{ gap: space.lg }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Choice
              label={t('tips.free')}
              selected={choice === 'free'}
              disabled={locked}
              onPress={() => {
                setChoice('free');
                onSend('price: free');
              }}
            />
            <Choice
              label={t('tips.notFree')}
              selected={choice === 'paid'}
              disabled={locked}
              onPress={() => {
                setChoice('paid');
                onEdit();
              }}
            />
          </View>
          <LateReveal open={choice === 'paid'}>
            <>
              <Composer
                value={amount}
                placeholder={t('tips.pricePlaceholder')}
                editable={!locked}
                onChange={(value) => {
                  setAmount(value);
                  setInvalid(false);
                }}
                onFocus={onEdit}
                keyboardType="decimal-pad"
              />
              {invalid ? (
                <AppText style={{ color: colors.danger }}>{t('tips.invalidPrice')}</AppText>
              ) : null}
              <PrimaryButton
                label={t('tips.send')}
                arrow
                disabled={locked || amount.trim().length === 0}
                onPress={() => {
                  const next = amount.trim().replace(/\s/g, '');
                  if (!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(next)) {
                    setInvalid(true);
                    return;
                  }
                  onSend(`price: ${next.replace('.', ',')}`);
                }}
              />
            </>
          </LateReveal>
        </View>
      </LateReveal>
    </View>
  );
}
