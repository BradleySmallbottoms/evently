import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { reloadAppAsync } from 'expo';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { PairingSheet, type PairingSheetTab } from '@/components/native/pairing-sheet';
import { TravelDistanceSetting } from '@/components/preferences/travel-distance-setting';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { api, throwIfError } from '@/lib/api';
import { clearLocalAppData, clearStoredPromptState } from '@/lib/clear-local-data';
import { ensureIdentity, loadStoredIdentity, refreshIdentitySession } from '@/lib/identity';
import { listNotifications } from '@/lib/notifications';
import { useHasUnreadNotifications } from '@/lib/use-unread-notifications';
import { getPreferences, updateTravelDistance } from '@/lib/preferences';
import { fetchProfile } from '@/lib/profile';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

function RowIcon({ sf, md }: { sf: string; md: keyof typeof MaterialIcons.glyphMap }) {
  const tint = colors.ink as string;
  return process.env.EXPO_OS === 'ios' ? (
    <SymbolView name={sf as never} size={22} tintColor={tint} />
  ) : (
    <MaterialIcons name={md} size={22} color={tint} />
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingTab, setPairingTab] = useState<PairingSheetTab>('web');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingNotice, setPairingNotice] = useState<string | null>(null);
  const [pairingPending, setPairingPending] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const [clearPromptsPending, setClearPromptsPending] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [travelError, setTravelError] = useState<string | null>(null);
  const devActionPending = resetPending || clearPromptsPending;

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const profile = useQuery({
    queryKey: ['profile', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => fetchProfile(identity.data!),
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
  });
  const inbox = useQuery({
    queryKey: ['notifications', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listNotifications(identity.data!),
  });
  const travelDistance = useMutation({
    mutationFn: async (distanceM: number) => {
      const id = identity.data;
      if (!id) throw new Error('missing_identity');
      await updateTravelDistance(id, distanceM);
    },
    onSuccess: async () => {
      setTravelError(null);
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
    onError: () => setTravelError(t('preferences.saveError')),
  });
  const travelDistanceM =
    (travelDistance.isPending ? travelDistance.variables : preferences.data?.travelDistanceM) ??
    25_000;

  const { hasUnread, numUnread } = useHasUnreadNotifications();
  const name = profile.data?.displayName?.trim() || t('profile.guest');

  async function confirmDeviceLink() {
    setPairingPending(true);
    setPairingError(null);
    setPairingNotice(null);
    try {
      const stored = await loadStoredIdentity();
      if (!stored) throw new Error('missing_identity');
      throwIfError(
        await api.POST('/pairing/device-link/confirm', {
          body: {
            deviceCredential: stored.deviceCredential,
            code: confirmCode.trim(),
          },
        }),
      );
      await refreshIdentitySession();
      setConfirmCode('');
      setPairingCode(null);
      setPairingNotice(t('events.pairingConfirmSuccess'));
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : t('events.pairingConfirmError'));
    } finally {
      setPairingPending(false);
    }
  }

  async function generatePairingCode() {
    setPairingPending(true);
    setPairingError(null);
    try {
      const stored = await loadStoredIdentity();
      if (!stored) throw new Error('missing_identity');
      const body =
        pairingTab === 'link'
          ? throwIfError(
              await api.POST('/pairing/device-link/code', {
                body: { deviceCredential: stored.deviceCredential },
              }),
            )
          : throwIfError(
              await api.POST('/pairing/code', {
                body: { deviceCredential: stored.deviceCredential },
              }),
            );
      setPairingCode(body.code);
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : t('events.pairingGenerateError'));
    } finally {
      setPairingPending(false);
    }
  }

  async function resetDevice() {
    setResetPending(true);
    setResetError(null);
    try {
      await clearLocalAppData();
      queryClient.clear();
      await reloadAppAsync();
    } catch {
      setResetError(t('preferences.resetError'));
    } finally {
      setResetPending(false);
    }
  }

  function promptReset() {
    Alert.alert(t('preferences.resetConfirmTitle'), t('preferences.resetConfirmMessage'), [
      { text: t('preferences.resetCancel'), style: 'cancel' },
      {
        text: t('preferences.resetConfirm'),
        style: 'destructive',
        onPress: () => {
          void resetDevice();
        },
      },
    ]);
  }

  async function clearRegionPrompts() {
    setClearPromptsPending(true);
    setResetError(null);
    try {
      await clearStoredPromptState();
      await reloadAppAsync();
    } catch {
      setResetError(t('preferences.resetError'));
    } finally {
      setClearPromptsPending(false);
    }
  }

  function promptClearRegionPrompts() {
    Alert.alert(
      t('preferences.clearPromptsConfirmTitle'),
      t('preferences.clearPromptsConfirmMessage'),
      [
        { text: t('preferences.resetCancel'), style: 'cancel' },
        {
          text: t('preferences.clearPromptsConfirm'),
          onPress: () => {
            void clearRegionPrompts();
          },
        },
      ],
    );
  }

  const countRows = [
    {
      label: t('profile.areas'),
      count: preferences.data?.areas.length ?? 0,
      href: '/profile/areas' as const,
      sf: 'mappin.and.ellipse',
      md: 'place' as const,
      alert: false,
    },
    {
      label: t('events.notifications'),
      count: inbox.data?.unreadCount ?? 0,
      href: '/profile/notifications' as const,
      sf: 'bell',
      md: 'notifications-none' as const,
      alert: hasUnread,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: space.xl,
          paddingBottom: BottomTabInset + space.xxxl,
          gap: space.lg,
          width: '100%',
          maxWidth: MaxContentWidth,
          alignSelf: 'center',
        }}
      >
        <AppText variant="title">{t('tabs.profile')}</AppText>
        {/* <View style={{ gap: space.xs }}>
          <AppText variant="subtitle">{name}</AppText>
          <AppText variant="caption">{t('profile.guestHint')}</AppText>
        </View> */}
        <View
          style={{
            backgroundColor: colors.card as string,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.line,
            overflow: 'hidden',
          }}
        >
          {countRows.map((row) => (
            <Pressable
              key={row.href}
              accessibilityRole="button"
              accessibilityLabel={
                row.alert
                  ? t('events.notificationsNew', { count: row.count })
                  : `${row.label} ${row.count}`
              }
              onPress={() => router.push(row.href)}
              style={{
                minHeight: 52,
                paddingHorizontal: space.lg,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
              }}
            >
              <View>
                <RowIcon sf={row.sf} md={row.md} />
                {row.alert ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: -1,
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: colors.danger,
                    }}
                  />
                ) : null}
              </View>
              <AppText variant="body" style={{ flex: 1 }}>
                {row.label}
              </AppText>
              <View
                style={{
                  minWidth: 28,
                  height: 28,
                  paddingHorizontal: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText variant="label" style={{ color: colors.ink }}>
                  {row.count}
                </AppText>
              </View>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => setPairingOpen(true)}
            style={{
              minHeight: 52,
              paddingHorizontal: space.lg,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
            }}
          >
            <RowIcon sf="link" md="link" />
            <AppText variant="body">{t('events.pairingTitle')}</AppText>
          </Pressable>
        </View>
        <TravelDistanceSetting
          value={travelDistanceM}
          disabled={!identity.data || preferences.isPending}
          onChange={(distanceM) => travelDistance.mutate(distanceM)}
        />
        {travelError ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {travelError}
          </AppText>
        ) : null}
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <RowIcon sf="wrench.and.screwdriver" md="build" />
            <AppText variant="subtitle">{t('preferences.resetSectionTitle')}</AppText>
          </View>
          <AppText variant="caption">{t('preferences.resetSectionHint')}</AppText>
          {resetError ? (
            <AppText variant="caption" style={{ color: colors.danger }}>
              {resetError}
            </AppText>
          ) : null}
          <PrimaryButton
            label={t('preferences.resetButton')}
            loading={resetPending}
            disabled={devActionPending}
            onPress={promptReset}
            style={{ backgroundColor: colors.danger }}
          />
          <PrimaryButton
            label={t('preferences.clearPromptsButton')}
            loading={clearPromptsPending}
            disabled={devActionPending}
            onPress={promptClearRegionPrompts}
          />
        </View>
      </ScrollView>

      <PairingSheet
        isPresented={pairingOpen}
        onDismiss={() => setPairingOpen(false)}
        tab={pairingTab}
        onTabChange={setPairingTab}
        webTabLabel={t('events.pairingWebTab')}
        linkTabLabel={t('events.pairingLinkTab')}
        title={t('events.pairingTitle')}
        hint={pairingTab === 'link' ? t('events.pairingLinkHint') : t('events.pairingHint')}
        code={pairingCode}
        error={pairingError}
        notice={pairingNotice}
        pending={pairingPending}
        generateLabel={t('events.pairingGenerate')}
        generatingLabel={t('events.pairingGenerating')}
        onGenerate={() => void generatePairingCode()}
        refreshLabel={t('events.pairingRefreshAfterLink')}
        onRefreshAfterLink={() => {
          void refreshIdentitySession().then(() => {
            setPairingNotice(t('events.pairingRefreshSuccess'));
          });
        }}
        confirmCode={confirmCode}
        onConfirmCodeChange={setConfirmCode}
        confirmLabel={t('events.pairingConfirm')}
        confirmingLabel={t('events.pairingConfirming')}
        onConfirm={() => void confirmDeviceLink()}
        confirmHint={t('events.pairingConfirmHint')}
      />
    </View>
  );
}
