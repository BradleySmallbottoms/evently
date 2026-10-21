import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

import { Choice } from './choice';
import { Composer } from './composer';
import { parsePrice } from './tip-answers';

export function PriceAsk({
  answer,
  locked,
  onSend,
  onEdit,
}: {
  answer: string | null;
  locked: boolean;
  onSend: (body: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const parsed = parsePrice(answer);
  const [choice, setChoice] = useState<'free' | 'paid' | null>(parsed.choice);
  const [amount, setAmount] = useState(parsed.amount);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!answer) return;
    const next = parsePrice(answer);
    setChoice(next.choice);
    setAmount(next.amount);
  }, [answer]);

  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
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
      {choice === 'paid' ? (
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
      ) : null}
    </View>
  );
}
