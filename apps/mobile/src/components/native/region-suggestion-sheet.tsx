import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BottomSheet, Host } from '@expo/ui';
import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';

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
};

function closeThen(onIsPresentedChange: (open: boolean) => void, action: () => void) {
  return () => {
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onIsPresentedChange(false);
    action();
  };
}

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
}: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={() => onIsPresentedChange(false)}
        containerColor={colors.card}
        contentPadding={{ top: space.sm, bottom: space.md, left: space.xl, right: space.xl }}
      >
        <View style={{ gap: space.lg }}>
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
            <AppText variant="subtitle" style={{ flex: 1, fontSize: 22, lineHeight: 28 }}>
              {title}
            </AppText>
          </View>
          <AppText style={{ color: colors.inkMuted, lineHeight: 22 }}>{message}</AppText>
          <View style={{ gap: space.sm }}>
            <PrimaryButton
              label={saveNotifyLabel}
              onPress={() => {
                onIsPresentedChange(false);
                onSaveNotify();
              }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={closeThen(onIsPresentedChange, onSaveQuiet)}
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
              onPress={closeThen(onIsPresentedChange, onNotNow)}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md }}
            >
              <AppText variant="subtitle" style={{ fontWeight: '600' }}>
                {notNowLabel}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={closeThen(onIsPresentedChange, onNever)}
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
      </BottomSheet>
    </Host>
  );
}
