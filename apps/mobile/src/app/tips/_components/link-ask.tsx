import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { bareTipLink } from '@local-events/domain';
import type { Tip } from '@local-events/contracts';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

import { Choice } from './choice';
import { Composer } from './composer';
import { FieldRow } from './field-row';
import { parseLink, replyMatches } from './tip-answers';

export function LinkAsk({
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
  const parsed = parseLink(answer);
  const opensInput = options.some((option) => option.reply == null);
  const [openInput, setOpenInput] = useState(parsed.url.length > 0);
  const [url, setUrl] = useState(parsed.url || seed || '');
  const [invalid, setInvalid] = useState(false);
  const showField = !opensInput || openInput;
  const lone = options.length === 1 ? options[0] : null;

  useEffect(() => {
    if (!answer) return;
    const next = parseLink(answer);
    setUrl(next.url);
    if (next.url) setOpenInput(true);
  }, [answer]);

  function pressOption(option: Tip['messages'][number]['options'][number]) {
    if (option.reply) {
      onSend(option.reply);
      return;
    }
    setOpenInput(true);
    setInvalid(false);
    if (!url && seed) setUrl(seed);
    onEdit();
  }

  return (
    <View style={{ gap: space.lg, marginTop: space.sm }}>
      {options.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {options.map((option, index) => (
            <Choice
              key={`${option.label}-${index}`}
              label={option.label}
              selected={
                option.reply
                  ? replyMatches(option.reply, answer)
                  : openInput || parsed.url.length > 0
              }
              disabled={locked}
              onPress={() => pressOption(option)}
            />
          ))}
        </View>
      ) : null}
      {showField ? (
        <>
          <FieldRow
            option={lone}
            selected={
              lone?.reply ? replyMatches(lone.reply, answer) : openInput || parsed.url.length > 0
            }
            locked={locked}
            onPress={() => {
              if (lone) pressOption(lone);
            }}
          >
            <Composer
              value={url}
              placeholder={t('tips.urlPlaceholder')}
              editable={!locked}
              onChange={(value) => {
                setUrl(value.replace(/^https?:\/\//i, ''));
                setInvalid(false);
              }}
              onFocus={onEdit}
              keyboardType="url"
              autoCapitalize="none"
            />
          </FieldRow>
          {invalid ? (
            <AppText style={{ color: colors.danger }}>{t('tips.invalidUrl')}</AppText>
          ) : null}
          <PrimaryButton
            label={t('tips.send')}
            arrow
            disabled={locked || url.trim().length === 0}
            onPress={() => {
              const bare = bareTipLink(url);
              if (!bare) {
                setInvalid(true);
                return;
              }
              onSend(`link: ${bare}`);
            }}
          />
        </>
      ) : lone ? (
        <Choice
          label={lone.label}
          selected={lone.reply ? replyMatches(lone.reply, answer) : openInput}
          disabled={locked}
          onPress={() => pressOption(lone)}
        />
      ) : null}
    </View>
  );
}
