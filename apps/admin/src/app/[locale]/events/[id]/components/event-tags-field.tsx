'use client';

import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Field, FieldLabel } from '@/components/ui/field';

type TagOption = { id: string; name: string };

type Props = {
  tags: readonly TagOption[];
  selectedIds: readonly string[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
};

/** Search to add a tag. Chosen tags sit under the field and can be removed. */
export function EventTagsField({ tags, selectedIds, disabled, onChange }: Props) {
  const t = useTranslations('EventEditor');
  const [input, setInput] = useState('');
  const selected = selectedIds.map((id) => tags.find((tag) => tag.id === id) ?? { id, name: id });
  const options = tags.filter((tag) => !selectedIds.includes(tag.id));

  return (
    <Field>
      <FieldLabel htmlFor="event-tags">{t('categories')}</FieldLabel>
      <Combobox<TagOption>
        items={options}
        value={null}
        inputValue={input}
        disabled={disabled}
        itemToStringLabel={(option) => option.name}
        isItemEqualToValue={(option, item) => option.id === item.id}
        onInputValueChange={(value, details) => {
          setInput(details.reason === 'item-press' ? '' : value);
        }}
        onValueChange={(value) => {
          if (value == null || selectedIds.includes(value.id)) return;
          onChange([...selectedIds, value.id]);
          setInput('');
        }}
      >
        <ComboboxInput
          id="event-tags"
          className="w-full"
          placeholder={t('categoriesPlaceholder')}
          disabled={disabled}
          showClear={false}
        />
        <ComboboxContent>
          <ComboboxEmpty>{t('categoriesEmpty')}</ComboboxEmpty>
          <ComboboxList>
            {(tag: TagOption) => (
              <ComboboxItem key={tag.id} value={tag}>
                {tag.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((tag) => (
            <Badge key={tag.id} variant="secondary">
              {tag.name}
              <button
                type="button"
                aria-label={tag.name}
                onClick={() => onChange(selectedIds.filter((id) => id !== tag.id))}
              >
                <XIcon />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </Field>
  );
}
