import { Host, Switch } from '@expo/ui';

type Props = {
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
};

export function CenteredSwitch({ value, disabled = false, onValueChange }: Props) {
  return (
    <Host matchContents style={{ alignSelf: 'center' }}>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} />
    </Host>
  );
}
