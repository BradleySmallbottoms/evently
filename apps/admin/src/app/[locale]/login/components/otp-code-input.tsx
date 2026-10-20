'use client';

import { useEffect, useId, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent, ChangeEvent } from 'react';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const LENGTH = 6;

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

  function onCellChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const incoming = digitsOnly(raw);
    if (incoming.length > 1) {
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

  function onCellKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
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

  function onCellPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
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
    <Field className="w-full items-center">
      <FieldLabel id={labelId}>{label}</FieldLabel>
      <div className="flex justify-center gap-2" role="group" aria-labelledby={labelId}>
        {digits.map((digit, index) => (
          <Input
            key={index}
            value={digit}
            disabled={disabled}
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && index === 0}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            aria-label={`${label} ${index + 1}`}
            ref={(el) => {
              refs.current[index] = el;
            }}
            className="size-12 px-0 text-center text-xl font-semibold md:text-xl"
            onChange={(event) => onCellChange(index, event)}
            onKeyDown={(event) => onCellKeyDown(index, event)}
            onPaste={(event) => onCellPaste(index, event)}
            onFocus={(event) => event.target.select()}
          />
        ))}
      </div>
    </Field>
  );
}
