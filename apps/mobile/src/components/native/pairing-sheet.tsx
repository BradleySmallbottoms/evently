import { BottomSheet, Host, Text } from '@expo/ui';
import { TextInput, useWindowDimensions, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';
import { SheetBody } from './sheet-body';
import { AppText } from '../ui/app-text';

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
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = windowWidth - space.xl * 2;
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        containerColor={colors.card}
        contentPadding={{ top: space.xxxl, bottom: space.md, left: space.xl, right: space.xl }}
      >
        <SheetBody>
          <View style={{ width: contentWidth, gap: space.lg, }}>
            <View style={{ gap: space.lg }}>
              <AppText variant="title" style={{ fontSize: 20, fontWeight: '700' }}>{title}</AppText>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <PrimaryButton
                  label={webTabLabel}
                  onPress={() => onTabChange('web')}
                  style={{
                    flex: 1,
                  }}
                />
                <PrimaryButton
                  label={linkTabLabel}
                  onPress={() => onTabChange('link')}
                  style={{
                    flex: 1,
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
            </View>
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}
