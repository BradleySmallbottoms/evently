import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BottomSheet, Host } from '@expo/ui';
import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { SheetBody } from '@/components/native/sheet-body';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  title: string;
  message: string;
  saveNotifyLabel: string;
  saveQuietLabel: string;
  notNowLabel: string;
  neverLabel: string;
  isPresented: boolean;
  onIsPresentedChange: (open: boolean) => void;
  onSaveNotify: () => void;
  onSaveQuiet: () => void;
  onNotNow: () => void;
  onNever: () => void;
  /** Sheet closed without Save, Not now, or Never (swipe or scrim). */
  onUserDismiss: () => void;
};

/** Offer to save a newly visited region (device-side suggestion). */
export function RegionSuggestionSheet({
  title,
  message,
  saveNotifyLabel,
  saveQuietLabel,
  notNowLabel,
  neverLabel,
  isPresented,
  onIsPresentedChange,
  onSaveNotify,
  onSaveQuiet,
  onNotNow,
  onNever,
  onUserDismiss,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const closedByAction = useRef(false);
  function runAction(action: () => void) {
    return () => {
      closedByAction.current = true;
      if (process.env.EXPO_OS === 'ios') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onIsPresentedChange(false);
      action();
    };
  }
  function dismissSheet() {
    const fromAction = closedByAction.current;
    closedByAction.current = false;
    onIsPresentedChange(false);
    if (!fromAction) onUserDismiss();
  }
  // The sheet sizes itself to its content. Unconstrained text measures as one
  // line and pushes that content past the sheet edges, so pin the column to
  // the width left after the sheet's horizontal padding.
  const contentWidth = windowWidth - space.xl * 2;

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={dismissSheet}
        containerColor={colors.card}
        contentPadding={{ top: space.xxxl, bottom: space.md, left: space.xl, right: space.xl }}
      >
        <SheetBody>
          <View style={{ width: contentWidth, gap: space.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="place" size={24} color={colors.primary} />
              </View>
              <AppText
                variant="subtitle"
                style={{ flex: 1, flexShrink: 1, fontSize: 22, lineHeight: 28 }}
              >
                {title}
              </AppText>
            </View>
            <AppText style={{ width: contentWidth, color: colors.inkMuted, lineHeight: 22 }}>
              {message}
            </AppText>
            <View style={{ gap: space.sm }}>
              <PrimaryButton
                label={saveNotifyLabel}
                onPress={() => {
                  closedByAction.current = true;
                  onIsPresentedChange(false);
                  onSaveNotify();
                }}
              />
              <Pressable
                accessibilityRole="button"
                onPress={runAction(onSaveQuiet)}
                style={({ pressed }) => ({
                  minHeight: 52,
                  borderRadius: radius.xl,
                  borderCurve: 'continuous',
                  borderWidth: 1.5,
                  borderColor: colors.line,
                  backgroundColor: pressed ? colors.canvas : colors.card,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: space.md,
                  paddingHorizontal: space.lg,
                })}
              >
                <AppText variant="subtitle" style={{ fontWeight: '700', textAlign: 'center' }}>
                  {saveQuietLabel}
                </AppText>
              </Pressable>
            </View>
            <View style={{ gap: space.xs, alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                onPress={runAction(onNotNow)}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md }}
              >
                <AppText variant="subtitle" style={{ fontWeight: '600' }}>
                  {notNowLabel}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={runAction(onNever)}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md }}
              >
                <AppText
                  variant="caption"
                  style={{ fontWeight: '600', textAlign: 'center', color: colors.inkMuted }}
                >
                  {neverLabel}
                </AppText>
              </Pressable>
            </View>
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}
