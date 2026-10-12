'use client';

import Box from '@mui/material/Box';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';
import { useEffect, useId, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent, ChangeEvent } from 'react';

const LENGTH = 6;

const styles: Record<string, SxProps<Theme>> = {
  root: {
    width: '100%',
  },
  boxes: {
    justifyContent: 'center',
  },
  cell: {
    width: 48,
    '& .MuiInputBase-input': {
      textAlign: 'center',
      fontSize: '1.25rem',
      fontWeight: 600,
      py: 1.25,
    },
  },
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, LENGTH);
}

type OtpCodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function OtpCodeInput({
  value,
  onChange,
  label,
  disabled = false,
  autoFocus = false,
}: OtpCodeInputProps) {
  const labelId = useId();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => {
      refs.current[0]?.focus();
      refs.current[0]?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  function focusAt(index: number) {
    const el = refs.current[Math.max(0, Math.min(LENGTH - 1, index))];
    el?.focus();
    el?.select();
  }

  function setDigits(next: string[]) {
    onChange(next.join('').slice(0, LENGTH));
  }

  function onCellChange(
    index: number,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const raw = event.target.value;
    const incoming = digitsOnly(raw);
    if (incoming.length > 1) {
      // Mobile autofill / multi-char into one cell
      const merged = digitsOnly(value.slice(0, index) + incoming + value.slice(index + 1));
      onChange(merged);
      focusAt(Math.min(merged.length, LENGTH - 1));
      return;
    }
    const next = [...digits];
    next[index] = incoming.slice(-1);
    setDigits(next);
    if (incoming) focusAt(index + 1);
  }

  function onCellKeyDown(index: number, event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        setDigits(next);
        return;
      }
      if (index > 0) {
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
        focusAt(index - 1);
      }
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAt(index - 1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAt(index + 1);
      return;
    }
  }

  function onCellPaste(index: number, event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const pasted = digitsOnly(event.clipboardData.getData('text'));
    if (!pasted) return;
    const next = [...digits];
    for (let i = 0; i < pasted.length && index + i < LENGTH; i += 1) {
      next[index + i] = pasted[i]!;
    }
    setDigits(next);
    focusAt(Math.min(index + pasted.length, LENGTH - 1));
  }

  return (
    <Box sx={styles.root}>
      <FormLabel id={labelId} sx={{ mb: 1, display: 'block', textAlign: 'center' }}>
        {label}
      </FormLabel>
      <Stack direction="row" spacing={1} sx={styles.boxes} role="group" aria-labelledby={labelId}>
        {digits.map((digit, index) => (
          <TextField
            key={index}
            value={digit}
            disabled={disabled}
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && index === 0}
            inputRef={(el) => {
              refs.current[index] = el;
            }}
            sx={styles.cell}
            onChange={(event) => onCellChange(index, event)}
            onKeyDown={(event) => onCellKeyDown(index, event)}
            onPaste={(event) => onCellPaste(index, event)}
            onFocus={(event) => event.target.select()}
            slotProps={{
              htmlInput: {
                inputMode: 'numeric',
                pattern: '[0-9]*',
                maxLength: 1,
                'aria-label': `${label} ${index + 1}`,
              },
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}
