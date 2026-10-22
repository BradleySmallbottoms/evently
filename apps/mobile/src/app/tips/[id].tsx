import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, TextInput } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ensureIdentity } from '@/lib/identity';
import { confirmTip, getTip } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';
import type { Tip } from '@local-events/contracts';

import { TipChrome } from '@/components/ui/tip-chrome';
import { TipChat } from './_components/tip-chat';
import { TipSummary } from './_components/tip-summary';

export default function TipScreen() {
  const { id, photo } = useLocalSearchParams<{ id: string; photo?: string }>();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const tip = useQuery({
    queryKey: ['tip', id],
    enabled: identity.isSuccess && Boolean(id),
    queryFn: () => getTip(identity.data!, id!),
    refetchInterval: (query) => (query.state.data?.imageStatus === 'scanning' ? 2000 : false),
  });
  const [revising, setRevising] = useState(false);

  if (!tip.data) {
    return (
      <TipChrome>
        <ActivityIndicator color={colors.ink} />
      </TipChrome>
    );
  }

  const data = tip.data;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tip', id] });
    await queryClient.invalidateQueries({ queryKey: ['tips'] });
  };

  if (data.phase === 'follow_up') {
    return (
      <FollowUp
        tip={data}
        onDone={async (next) => {
          queryClient.setQueryData(['tip', id], next);
          await refresh();
        }}
      />
    );
  }
  if (
    data.phase === 'confirm' ||
    data.phase === 'receipt' ||
    data.phase === 'review' ||
    data.phase === 'published' ||
    data.phase === 'failed'
  ) {
    if (revising && data.phase === 'confirm') {
      return (
        <TipChat
          tip={data}
          revising
          initialPhoto={typeof photo === 'string' ? photo : undefined}
          onDone={(next) => {
            queryClient.setQueryData(['tip', id], next);
            setRevising(false);
          }}
        />
      );
    }
    return (
      <TipSummary
        tip={data}
        photo={typeof photo === 'string' ? photo : undefined}
        onDone={(next) => queryClient.setQueryData(['tip', id], next)}
        onRevise={() => setRevising(true)}
      />
    );
  }
  return (
    <TipChat
      tip={data}
      initialPhoto={typeof photo === 'string' ? photo : undefined}
      onDone={(next) => queryClient.setQueryData(['tip', id], next)}
    />
  );
}

function FollowUp({ tip, onDone }: { tip: Tip; onDone: (tip: Tip) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      const identity = await ensureIdentity(locale);
      return confirmTip(identity, tip.id, {
        description: description || undefined,
        submitFollowUp: true,
      });
    },
    onSuccess: (next) => void onDone(next),
    onError: () => setError(t('tips.error')),
  });
  return (
    <TipChrome
      title={t('tips.followTitle')}
      footer={
        <PrimaryButton
          label={t('tips.submit')}
          loading={send.isPending}
          onPress={() => send.mutate()}
        />
      }
    >
      <AppText variant="body">{t('tips.followBody')}</AppText>
      {tip.followUp?.description ? (
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t('tips.shortDescription')}
          placeholderTextColor={colors.inkMuted}
          multiline
          style={{
            minHeight: 80,
            backgroundColor: colors.card,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.line,
            padding: space.md,
            color: colors.ink,
          }}
        />
      ) : null}
      {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
    </TipChrome>
  );
}
