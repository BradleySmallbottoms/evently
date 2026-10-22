import { tipEditable } from '@local-events/domain';
import type { TipListResponse } from '@local-events/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TipChatSheet } from '@/components/native/tip-chat-sheet';
import { ActionList } from '@/components/ui/action-list';
import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { MaxContentWidth } from '@/constants/theme';
import { ensureIdentity } from '@/lib/identity';
import { deleteTip, listTips } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function MyTipsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const tips = useQuery({
    queryKey: ['tips', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listTips(identity.data!),
  });
  const remove = useMutation({
    mutationFn: (tipId: string) => deleteTip(identity.data!, tipId),
    onMutate: (tipId) => {
      const key = ['tips', identity.data?.userId] as const;
      queryClient.setQueryData<TipListResponse>(key, (current) =>
        current ? { items: current.items.filter((tip) => tip.id !== tipId) } : current,
      );
    },
    onError: () => {
      setRemoveError(t('tips.removeError'));
      void queryClient.invalidateQueries({ queryKey: ['tips', identity.data?.userId] });
    },
    onSuccess: () => {
      setRemoveError(null);
      void queryClient.invalidateQueries({ queryKey: ['tips', identity.data?.userId] });
    },
  });
  const items = tips.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View
        style={{
          width: '100%',
          maxWidth: MaxContentWidth,
          alignSelf: 'center',
          flex: 1,
        }}
      >
        <View
          style={{
            paddingTop: insets.top + space.sm,
            paddingHorizontal: space.xl,
            paddingBottom: space.md,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <BackPill />
          <AppText variant="title" style={{ flex: 1, textAlign: 'center' }}>
            {t('tips.mine')}
          </AppText>
          <View style={{ width: '15%' }} />
        </View>
        {tips.isPending ? <ActivityIndicator color={colors.ink} /> : null}
        {tips.isError ? (
          <AppText style={{ color: colors.danger, paddingHorizontal: space.xl }}>
            {t('tips.error')}
          </AppText>
        ) : null}
        {removeError ? (
          <AppText style={{ color: colors.danger, paddingHorizontal: space.xl }}>
            {removeError}
          </AppText>
        ) : null}
        {tips.isSuccess && items.length === 0 ? (
          <AppText variant="body" style={{ color: colors.inkMuted, paddingHorizontal: space.xl }}>
            {t('tips.empty')}
          </AppText>
        ) : null}
        <ActionList
          editLabel={t('lists.edit')}
          deleteLabel={t('lists.delete')}
          items={items.map((tip) => {
            const title = tip.found?.title ?? tip.card?.title ?? t('tips.fallbackTitle');
            const open = () => setOpenId(tip.id);
            return {
              id: tip.id,
              title,
              subtitle: t(`tips.phase.${tip.phase}`),
              onPress: open,
              onEdit: tipEditable(tip.phase) ? open : undefined,
              onDelete: () => remove.mutate(tip.id),
            };
          })}
        />
      </View>
      <TipChatSheet
        tipId={openId}
        onDismiss={() => {
          setOpenId(null);
          void tips.refetch();
        }}
      />
    </View>
  );
}
