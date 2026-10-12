import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  accessibilityLabel: string;
  shareLabel: string;
  copyLinkLabel: string;
  reportLabel: string;
  onShare: () => void;
  onCopyLink: () => void;
  onReport: () => void;
  buttonStyle?: StyleProp<ViewStyle>;
};

/** Universal BottomSheet fallback for event overflow actions (Android / web). */
export function EventActionsMenu({
  accessibilityLabel,
  shareLabel,
  copyLinkLabel,
  reportLabel,
  onShare,
  onCopyLink,
  onReport,
  buttonStyle,
}: Props) {
  const [open, setOpen] = useState(false);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <CircleIconButton
        plain
        tintColor={colors.ink as string}
        sf="ellipsis"
        md="more-horiz"
        accessibilityLabel={accessibilityLabel}
        onPress={() => setOpen(true)}
        style={buttonStyle}
      />
      <Host style={{ position: 'absolute', width: 0, height: 0 }}>
        <BottomSheet isPresented={open} onDismiss={() => setOpen(false)}>
          <Column spacing={8}>
            <ActionRow
              label={shareLabel}
              onPress={() => {
                setOpen(false);
                setTimeout(onShare, 300);
              }}
            />
            <ActionRow label={copyLinkLabel} onPress={() => run(onCopyLink)} />
            <ActionRow label={reportLabel} danger onPress={() => run(onReport)} />
          </Column>
        </BottomSheet>
      </Host>
    </>
  );
}

function ActionRow({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress}>
      <View style={{ paddingVertical: space.md }}>
        <Text
          textStyle={{
            fontSize: 17,
            fontWeight: '600',
            color: danger ? colors.danger : (colors.ink as string),
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
