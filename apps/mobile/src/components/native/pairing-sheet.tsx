import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export type PairingSheetTab = 'web' | 'link';

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  tab: PairingSheetTab;
  onTabChange: (tab: PairingSheetTab) => void;
  webTabLabel: string;
  linkTabLabel: string;
  title: string;
  hint: string;
  code: string | null;
  error: string | null;
  notice: string | null;
  pending: boolean;
  generateLabel: string;
  generatingLabel: string;
  onGenerate: () => void;
  /** New phone: refresh identity after the old phone confirms. */
  refreshLabel: string;
  onRefreshAfterLink: () => void;
  /** Old-phone confirm fields (device link tab). */
  confirmCode: string;
  onConfirmCodeChange: (value: string) => void;
  confirmLabel: string;
  confirmingLabel: string;
  onConfirm: () => void;
  confirmHint: string;
};

export function PairingSheet({
  isPresented,
  onDismiss,
  tab,
  onTabChange,
  webTabLabel,
  linkTabLabel,
  title,
  hint,
  code,
  error,
  notice,
  pending,
  generateLabel,
  generatingLabel,
  onGenerate,
  refreshLabel,
  onRefreshAfterLink,
  confirmCode,
  onConfirmCodeChange,
  confirmLabel,
  confirmingLabel,
  onConfirm,
  confirmHint,
}: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet isPresented={isPresented} onDismiss={onDismiss} snapPoints={['half']}>
        <Column spacing={12}>
          <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <PrimaryButton
              label={webTabLabel}
              onPress={() => onTabChange('web')}
              style={{
                flex: 1,
                backgroundColor: tab === 'web' ? colors.accent : colors.ink,
              }}
            />
            <PrimaryButton
              label={linkTabLabel}
              onPress={() => onTabChange('link')}
              style={{
                flex: 1,
                backgroundColor: tab === 'link' ? colors.accent : colors.ink,
              }}
            />
          </View>
          <Text textStyle={{ fontSize: 14, color: colors.inkMuted as string }}>{hint}</Text>
          {tab === 'web' || tab === 'link' ? (
            <>
              {code ? (
                <Text textStyle={{ fontSize: 28, fontWeight: '700', fontFamily: 'monospace' }}>
                  {code}
                </Text>
              ) : null}
              <View style={{ marginTop: space.sm, gap: space.sm }}>
                <PrimaryButton
                  label={pending ? generatingLabel : generateLabel}
                  loading={pending}
                  onPress={onGenerate}
                />
                {tab === 'link' && code ? (
                  <PrimaryButton
                    label={refreshLabel}
                    loading={pending}
                    onPress={onRefreshAfterLink}
                    style={{ backgroundColor: colors.ink }}
                  />
                ) : null}
              </View>
            </>
          ) : null}
          {tab === 'link' ? (
            <>
              <Text textStyle={{ fontSize: 14, color: colors.inkMuted as string }}>
                {confirmHint}
              </Text>
              <TextInput
                value={confirmCode}
                onChangeText={onConfirmCodeChange}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
                placeholder="ABCD2345"
                placeholderTextColor={colors.inkMuted as string}
                style={{
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.md,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  fontSize: 20,
                  fontFamily: 'monospace',
                  letterSpacing: 2,
                  color: colors.ink as string,
                  backgroundColor: colors.card as string,
                }}
              />
              <PrimaryButton
                label={pending ? confirmingLabel : confirmLabel}
                loading={pending}
                onPress={onConfirm}
              />
            </>
          ) : null}
          {notice ? (
            <Text textStyle={{ fontSize: 14, color: colors.accent as string }}>{notice}</Text>
          ) : null}
          {error ? (
            <Text textStyle={{ fontSize: 14, color: colors.danger }}>{error}</Text>
          ) : null}
        </Column>
      </BottomSheet>
    </Host>
  );
}
