import { Host } from '@expo/ui';
import { Button, Divider, Menu, RNHostView } from '@expo/ui/swift-ui';
import { View, type StyleProp, type ViewStyle } from 'react-native';

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
  /** Save / interested. Omitted on list cards. */
  interestedLabel?: string;
  interestedOn?: boolean;
  onInterested?: () => void;
  comingLabel?: string;
  comingOn?: boolean;
  onComing?: () => void;
  /** Physical events that have coordinates. */
  directionsLabel?: string;
  onDirections?: () => void;
  followLabel?: string;
  following?: boolean;
  onFollow?: () => void;
  /** Shown only while a reminder can still be set or changed. */
  remindLabel?: string;
  onRemind?: () => void;
  buttonStyle?: StyleProp<ViewStyle>;
};

/** SwiftUI menu for event overflow actions. Opens on tap (iOS only). */
export function EventActionsMenu({
  accessibilityLabel,
  shareLabel,
  copyLinkLabel,
  reportLabel,
  onShare,
  onCopyLink,
  onReport,
  interestedLabel,
  interestedOn,
  onInterested,
  comingLabel,
  comingOn,
  onComing,
  directionsLabel,
  onDirections,
  followLabel,
  following,
  onFollow,
  remindLabel,
  onRemind,
  buttonStyle,
}: Props) {
  return (
    <Host matchContents>
      <Menu
        label={
          <RNHostView matchContents>
            {/* The icon must not take the tap, or the menu never opens. */}
            <View pointerEvents="none">
              <CircleIconButton
                plain
                tintColor={colors.ink as string}
                sf="ellipsis"
                md="more-horiz"
                accessibilityLabel={accessibilityLabel}
                style={buttonStyle}
              />
            </View>
          </RNHostView>
        }
      >
        {interestedLabel && onInterested ? (
          <Button
            systemImage={interestedOn ? 'heart.fill' : 'heart'}
            onPress={onInterested}
            label={interestedLabel}
          />
        ) : null}
        {comingLabel && onComing ? (
          <Button
            systemImage={comingOn ? 'checkmark.circle.fill' : 'checkmark.circle'}
            onPress={onComing}
            label={comingLabel}
          />
        ) : null}
        <Button
          systemImage="square.and.arrow.up"
          onPress={() => {
            // Let the context menu finish dismissing before the share sheet.
            setTimeout(onShare, 300);
          }}
          label={shareLabel}
        />
        {directionsLabel && onDirections ? (
          <Button
            systemImage="arrow.triangle.turn.up.right.diamond"
            onPress={() => {
              setTimeout(onDirections, 300);
            }}
            label={directionsLabel}
          />
        ) : null}
        {followLabel && onFollow ? (
          <Button
            systemImage={following ? 'person.fill.checkmark' : 'person.badge.plus'}
            onPress={onFollow}
            label={followLabel}
          />
        ) : null}
        <Button systemImage="link" onPress={onCopyLink} label={copyLinkLabel} />
        {remindLabel && onRemind ? (
          <Button
            systemImage="bell"
            onPress={() => {
              setTimeout(onRemind, 300);
            }}
            label={remindLabel}
          />
        ) : null}
        <Divider />
        <Button
          systemImage="exclamationmark.triangle"
          role="destructive"
          onPress={onReport}
          label={reportLabel}
        />
      </Menu>
    </Host>
  );
}
