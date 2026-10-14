'use client';

import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
  const selected = selectedIds.map(
    (id) => tags.find((tag) => tag.id === id) ?? { id, name: id },
  );
  const options = tags.filter((tag) => !selectedIds.includes(tag.id));

  return (
    <Stack spacing={1}>
      <Autocomplete
        options={options}
        value={null}
        inputValue={input}
        disabled={disabled}
        onInputChange={(_event, value, reason) => {
          setInput(reason === 'reset' ? '' : value);
        }}
        onChange={(_event, value) => {
          if (!value || selectedIds.includes(value.id)) return;
          onChange([...selectedIds, value.id]);
          setInput('');
        }}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        noOptionsText={t('categoriesEmpty')}
        renderInput={(params) => (
          <TextField
            {...params}
            label={t('categories')}
            placeholder={t('categoriesPlaceholder')}
            fullWidth
          />
        )}
      />
      {selected.length > 0 ? (
        <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
          {selected.map((tag) => (
            <Chip
              key={tag.id}
              size="small"
              label={tag.name}
              onDelete={() => onChange(selectedIds.filter((id) => id !== tag.id))}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
