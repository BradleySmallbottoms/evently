import { Host, Switch } from '@expo/ui';
import { wrapContentHeight } from '@expo/ui/jetpack-compose/modifiers';

type Props = {
  value: boolean;
  onValueChange: (value: boolean) => void;
};

/** Compose switch hugs its height and stays vertically centered in the row. */
export function CenteredSwitch({ value, onValueChange }: Props) {
  return (
    <Host matchContents style={{ alignSelf: 'center' }}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        modifiers={[wrapContentHeight('centerVertically')]}
      />
    </Host>
  );
}
