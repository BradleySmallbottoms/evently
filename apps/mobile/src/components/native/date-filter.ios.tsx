import { Host } from '@expo/ui';
import { DatePicker } from '@expo/ui/swift-ui';

type Props = {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
};

/** SwiftUI DatePicker for filtering events by day (iOS). */
export function DateFilter({ label, value, onChange }: Props) {
  return (
    <Host matchContents>
      <DatePicker
        title={label}
        selection={value}
        displayedComponents={['date']}
        onDateChange={onChange}
      />
    </Host>
  );
}
