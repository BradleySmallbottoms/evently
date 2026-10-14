import { Host, Switch } from '@expo/ui';
import { fixedSize, frame } from '@expo/ui/swift-ui/modifiers';

type Props = {
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
};

/** SwiftUI Toggle hugs its own size, so the first layout is already centered in the row. */
export function CenteredSwitch({ value, disabled = false, onValueChange }: Props) {
  return (
    <Host matchContents ignoreSafeArea="all" style={{ alignSelf: 'center' }}>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        modifiers={[fixedSize(), frame({ width: 51, height: 31, alignment: 'center' })]}
      />
    </Host>
  );
}
