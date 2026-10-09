import { Host } from '@expo/ui';
import { Button, ContextMenu, Divider } from '@expo/ui/swift-ui';

import { CircleIconButton } from '@/components/ui/circle-icon-button';

type Props = {
  accessibilityLabel: string;
  shareLabel: string;
  copyLinkLabel: string;
  reportLabel: string;
  onShare: () => void;
  onCopyLink: () => void;
  onReport: () => void;
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
}: Props) {
  return (
    <Host matchContents>
      <ContextMenu>
        <ContextMenu.Trigger>
          <CircleIconButton sf="ellipsis" accessibilityLabel={accessibilityLabel} />
        </ContextMenu.Trigger>
        <ContextMenu.Items>
          <Button systemImage="square.and.arrow.up" onPress={onShare} label={shareLabel} />
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
