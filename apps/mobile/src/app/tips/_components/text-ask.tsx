import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { space } from '@/theme/tokens';

import { Composer } from './composer';

export function TextAsk({
  icon,
  answer,
  locked,
  onSend,
  onEdit,
}: {
  icon?: 'place';
  answer: string | null;
  locked: boolean;
  onSend: (body: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(answer ?? '');

  useEffect(() => {
    if (answer != null) setValue(answer);
  }, [answer]);

  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      <Composer
        value={value}
        placeholder={t('tips.writePlaceholder')}
        editable={!locked}
        icon={icon}
        onChange={setValue}
        onFocus={onEdit}
      />
      <PrimaryButton
        label={t('tips.send')}
        arrow
        disabled={locked || value.trim().length === 0}
        onPress={() => onSend(value)}
      />
    </View>
  );
}
