import { Host, Switch } from '@expo/ui';

type Props = {
  value: boolean;
  onValueChange: (value: boolean) => void;
};

export function CenteredSwitch({ value, onValueChange }: Props) {
  return (
    <Host matchContents style={{ alignSelf: 'center' }}>
      <Switch value={value} onValueChange={onValueChange} />
    </Host>
  );
}
