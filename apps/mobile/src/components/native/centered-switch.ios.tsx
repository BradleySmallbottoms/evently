import { Host, Switch } from '@expo/ui';
import { fixedSize, frame } from '@expo/ui/swift-ui/modifiers';

type Props = {
  value: boolean;
  onValueChange: (value: boolean) => void;
};

/** SwiftUI Toggle hugs its own size, so the first layout is already centered in the row. */
export function CenteredSwitch({ value, onValueChange }: Props) {
  return (
    <Host matchContents ignoreSafeArea="all" style={{ alignSelf: 'center' }}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        modifiers={[fixedSize(), frame({ width: 51, height: 31, alignment: 'center' })]}
      />
    </Host>
  );
}
