import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Tip } from '@local-events/contracts';

import { PhotoSourceMenu } from '@/components/native/photo-source-menu';
import type { TipImageSource } from '@/lib/camera';
import { radius, space } from '@/theme/tokens';

import { AskControl } from './ask-control';
import { ChatArrival } from './chat-arrival';
import { Choice } from './choice';
import { ContentWarning } from './content-warning';

const CHANGE_KEYS = [
  'title',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'place',
  'price',
  'link',
  'description',
  'image',
] as const;

type ChangeKey = (typeof CHANGE_KEYS)[number];

export function ChangeAsk({
  tip,
  locale,
  locked,
  warning,
  photoUri,
  question,
  onSend,
  onEdit,
  onReplace,
  onDismissWarning,
}: {
  tip: Tip;
  locale: string;
  locked: boolean;
  warning: string | null;
  photoUri: string | null;
  question: ReactNode;
  onSend: (body: string) => void;
  onEdit: () => void;
  onReplace: (source: TipImageSource) => void;
  onDismissWarning: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<ChangeKey | null>(null);

  return (
    <View style={{ gap: space.md }}>
      <ChatArrival
        pieces={[
          <View key="ask">{question}</View>,
          <View key="options" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {CHANGE_KEYS.map((key) => (
              <Choice
                key={key}
                compact
                label={t(`tips.facts.${key}`)}
                selected={picked === key}
                disabled={locked || (picked != null && picked !== key)}
                onPress={() => {
                  setPicked(key);
                  onEdit();
                }}
              />
            ))}
          </View>,
        ]}
      />
      {picked === 'image' ? (
        <ChatArrival
          pieces={[
            <View key="image" style={{ gap: space.sm }}>
              {photoUri ? (
                <Image
                  key={photoUri}
                  accessibilityLabel={t('tips.facts.image')}
                  source={{ uri: photoUri }}
                  style={{ width: '100%', height: 220, borderRadius: radius.lg }}
                  contentFit="cover"
                />
              ) : null}
              <View style={{ flexDirection: 'row' }}>
                <PhotoSourceMenu
                  cameraLabel={t('tips.takePhoto')}
                  libraryLabel={t('tips.photoLibrary')}
                  onPick={onReplace}
                >
                  <Choice
                    label={t(photoUri ? 'tips.replacePicture' : 'tips.addPicture')}
                    selected={false}
                    disabled={locked}
                  />
                </PhotoSourceMenu>
              </View>
              {warning ? <ContentWarning text={warning} /> : null}
            </View>,
          ]}
        />
      ) : picked ? (
        <ChatArrival
          pieces={[
            <AskControl
              key={picked}
              askKey={picked}
              options={changeOptions(picked, t)}
              answer={null}
              locked={locked}
              locale={locale}
              startsAt={tip.card?.startsAt ?? null}
              endsAt={tip.card?.endsAt ?? null}
              title={tip.card?.title ?? null}
              place={tip.card?.place ?? null}
              priceLabel={tip.card?.priceLabel ?? null}
              link={tip.card?.link ?? null}
              description={tip.found?.description ?? tip.card?.summary ?? null}
              onSend={onSend}
              onEdit={onEdit}
              warning={warning}
              onDismissWarning={onDismissWarning}
            />,
          ]}
        />
      ) : null}
    </View>
  );
}

function changeOptions(
  key: ChangeKey,
  t: (key: string) => string,
): Tip['messages'][number]['options'] {
  if (key === 'endDate') return [{ label: t('tips.unknown'), reply: 'endDate: none' }];
  if (key === 'startTime') return [{ label: t('tips.unknown'), reply: 'startTime: none' }];
  if (key === 'endTime') return [{ label: t('tips.unknown'), reply: 'endTime: none' }];
  if (key === 'link') return [{ label: t('tips.noLink'), reply: 'link: none' }];
  return [];
}
