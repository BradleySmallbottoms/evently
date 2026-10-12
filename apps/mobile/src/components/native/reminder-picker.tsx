import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BottomSheet, Host } from '@expo/ui';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { SheetBody } from '@/components/native/sheet-body';
import { AppText } from '@/components/ui/app-text';
import type { ReminderSlot } from '@/lib/reminder-times';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Option = { slot: ReminderSlot; label: string };

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  title: string;
  body: string;
  options: Option[];
  /** Slots already scheduled. Used to pre-check when the sheet opens. */
  activeSlots: readonly ReminderSlot[];
  saveLabel: string;
  clearLabel: string;
  saving: boolean;
  onSave: (slots: ReminderSlot[]) => void;
  onClear?: () => void;
};

export function ReminderPicker({
  isPresented,
  onDismiss,
  title,
  body,
  options,
  activeSlots,
  saveLabel,
  clearLabel,
  saving,
  onSave,
  onClear,
}: Props) {
  const [checked, setChecked] = useState<ReminderSlot[]>([]);
  const wasPresented = useRef(false);

  useEffect(() => {
    if (isPresented && !wasPresented.current) {
      const available = options.map((option) => option.slot);
      const kept = available.filter((slot) => activeSlots.includes(slot));
      setChecked(kept.length > 0 ? kept : available);
    }
    wasPresented.current = isPresented;
  }, [isPresented, options, activeSlots]);

  const canSave = checked.length > 0 && !saving;

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        containerColor={colors.card}
        contentPadding={{ top: space.xxxl, bottom: space.lg, left: space.xl, right: space.xl }}
      >
        <SheetBody>
          <View style={{ gap: space.md }}>
            <AppText variant="subtitle" style={{ fontSize: 22, lineHeight: 28 }}>
              {title}
            </AppText>
            <AppText style={{ color: colors.inkMuted, lineHeight: 22 }}>{body}</AppText>
            <View style={{ gap: space.sm }}>
              {options.map((option) => {
                const on = checked.includes(option.slot);
                return (
                  <Pressable
                    key={option.slot}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={option.label}
                    onPress={() => {
                      setChecked((current) =>
                        current.includes(option.slot)
                          ? current.filter((slot) => slot !== option.slot)
                          : [...current, option.slot],
                      );
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      minHeight: 44,
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        borderWidth: 1.5,
                        borderColor: on ? colors.accent : colors.line,
                        backgroundColor: on ? colors.accent : colors.card,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {on ? <MaterialIcons name="check" size={16} color={colors.primary} /> : null}
                    </View>
                    <AppText>{option.label}</AppText>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={!canSave}
              onPress={() => onSave(checked)}
              style={{
                backgroundColor: colors.accent,
                borderRadius: radius.lg,
                minHeight: 52,
                paddingVertical: space.md,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: canSave ? 1 : 0.5,
              }}
            >
              <AppText variant="subtitle" style={{ fontWeight: '700', color: colors.primary }}>
                {saveLabel}
              </AppText>
            </Pressable>
            {onClear ? (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={onClear}
                style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <AppText variant="caption" style={{ fontWeight: '600', color: colors.inkMuted }}>
                  {clearLabel}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}
