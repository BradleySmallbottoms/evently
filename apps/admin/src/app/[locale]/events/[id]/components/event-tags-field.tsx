'use client';

import Autocomplete from '@mui/material/Autocomplete';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
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
        <Stack spacing={0.5}>
          {selected.map((tag) => (
            <Stack key={tag.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography sx={{ flex: 1 }}>{tag.name}</Typography>
              <IconButton
                size="small"
                aria-label={t('removeTag', { name: tag.name })}
                onClick={() => onChange(selectedIds.filter((id) => id !== tag.id))}
              >
                <Typography component="span" aria-hidden sx={{ lineHeight: 1 }}>
                  ×
                </Typography>
              </IconButton>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
