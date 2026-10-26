'use client';

import { useQuery } from '@tanstack/react-query';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { adminFetch } from '@/lib/api';

const ALL_WORKERS = 'all';

export function WorkerFilter({
  id,
  label,
  allLabel,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  onValueChange: (worker: string) => void;
}) {
  const workers = useQuery({
    queryKey: ['admin-event-workers'],
    queryFn: () => adminFetch<{ items: string[] }>('/events/workers'),
    retry: false,
  });
  const ids = workers.data?.items ?? [];
  const items: Record<string, string> = { [ALL_WORKERS]: allLabel };
  for (const workerId of ids) items[workerId] = workerId;

  return (
    <Field className="w-full min-w-[180px] max-w-60">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value === '' ? ALL_WORKERS : value}
        onValueChange={(next) => {
          if (next == null) return;
          onValueChange(next === ALL_WORKERS ? '' : next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL_WORKERS}>{allLabel}</SelectItem>
            {ids.map((workerId) => (
              <SelectItem key={workerId} value={workerId}>
                {workerId}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
