import { Host } from '@expo/ui';
import { Button, ContextMenu, Divider, RNHostView } from '@expo/ui/swift-ui';
import type { StyleProp, ViewStyle } from 'react-native';

import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { colors } from '@/theme/colors';

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

/** SwiftUI context menu for event detail overflow actions (iOS only). */
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
  return (
    <Host matchContents>
      <ContextMenu>
        <ContextMenu.Trigger>
          <RNHostView matchContents>
            <CircleIconButton
              plain
              tintColor={colors.ink as string}
              sf="ellipsis"
              md="more-horiz"
              accessibilityLabel={accessibilityLabel}
              style={buttonStyle}
            />
          </RNHostView>
        </ContextMenu.Trigger>
        <ContextMenu.Items>
          <Button
            systemImage="square.and.arrow.up"
            onPress={() => {
              // Let the context menu finish dismissing before the share sheet.
              setTimeout(onShare, 300);
            }}
            label={shareLabel}
          />
          <Button systemImage="link" onPress={onCopyLink} label={copyLinkLabel} />
          <Divider />
          <Button
            systemImage="exclamationmark.triangle"
            role="destructive"
            onPress={onReport}
            label={reportLabel}
          />
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}
