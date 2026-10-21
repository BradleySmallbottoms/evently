import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { ensureIdentity } from '@/lib/identity';
import { chooseTipImage } from '@/lib/tip-photo';
import { createTip, sendTipImage } from '@/lib/tips';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { TipChrome } from '@/components/ui/tip-chrome';

function RowIcon({ sf, md }: { sf: string; md: keyof typeof MaterialIcons.glyphMap }) {
  const tint = colors.ink as string;
  return process.env.EXPO_OS === 'ios' ? (
    <SymbolView name={sf as never} size={28} tintColor={tint} />
  ) : (
    <MaterialIcons name={md} size={28} color={tint} />
  );
}

export default function TipStartScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [pending, setPending] = useState<'photo' | 'text' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startText() {
    setPending('text');
    setError(null);
    try {
      const identity = await ensureIdentity(locale);
      const tip = await createTip(identity, { path: 'text', locale });
      router.push(`/tips/${tip.id}`);
    } catch {
      setError(t('tips.error'));
    } finally {
      setPending(null);
    }
  }

  async function startPhoto() {
    setPending('photo');
    setError(null);
    try {
      const shot = await chooseTipImage();
      if (!shot.ok) {
        if (shot.reason === 'denied') setError(t('tips.cameraDenied'));
        return;
      }
      const identity = await ensureIdentity(locale);
      const tip = await createTip(identity, { path: 'photo', locale });
      await sendTipImage(identity, tip.id, {
        contentType: shot.contentType,
        dataBase64: shot.dataBase64,
      });
      router.push({ pathname: '/tips/[id]', params: { id: tip.id, photo: shot.uri } });
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'too_large' ? t('tips.tooLarge') : t('tips.error'),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <TipChrome title={t('tips.startTitle')}>
      <AppText variant="body" style={{ textAlign: 'center', color: colors.inkMuted }}>
        {t('tips.startBody')}
      </AppText>
      <Choice
        title={t('tips.takePhoto')}
        body={t('tips.takePhotoBody')}
        icon={<RowIcon sf="camera" md="photo-camera" />}
        pending={pending === 'photo'}
        onPress={() => void startPhoto()}
      />
      <Choice
        title={t('tips.write')}
        body={t('tips.writeBody')}
        icon={<RowIcon sf="doc.text" md="notes" />}
        pending={pending === 'text'}
        onPress={() => void startText()}
      />
      <AppText variant="caption" style={{ color: colors.inkMuted }}>
        {t('tips.startFoot')}
      </AppText>
      {error ? (
        <AppText variant="caption" style={{ color: colors.danger }}>
          {error}
        </AppText>
      ) : null}
    </TipChrome>
  );
}

function Choice({
  title,
  body,
  icon,
  pending,
  onPress,
}: {
  title: string;
  body: string;
  icon: ReactNode;
  pending: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.line,
        padding: space.lg,
      }}
    >
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" style={{ color: colors.inkMuted }}>
          {body}
        </AppText>
      </View>
      {pending ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <AppText style={{ color: colors.inkMuted }}>›</AppText>
      )}
    </Pressable>
  );
}
