'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type EventMode = 'physical' | 'digital';

export type ManagedEventFieldValues = {
  title?: string;
  description?: string | null;
  mode: EventMode;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  venueName?: string | null;
  lat?: number | null;
  lng?: number | null;
  geofenceRadiusM?: number | null;
  onlineUrl?: string | null;
  tagIds?: string[];
};

export type TagOption = {
  id: string;
  name: string;
};

type Props = {
  mode: EventMode;
  onModeChange: (mode: EventMode) => void;
  categories: TagOption[] | undefined;
  categoriesLoading: boolean;
  categoriesError: boolean;
  values?: ManagedEventFieldValues;
  categoriesInputId: string;
};

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function ManagedEventFields({
  mode,
  onModeChange,
  categories,
  categoriesLoading,
  categoriesError,
  values,
  categoriesInputId,
}: Props) {
  const t = useTranslations('Events');

  return (
    <>
      <Field id="event-title" label={t('title')}>
        <Input
          id="event-title"
          name="title"
          required
          defaultValue={values?.title ?? ''}
          minLength={2}
        />
      </Field>
      <Field id="event-description" label={t('description')}>
        <Textarea
          id="event-description"
          name="description"
          rows={4}
          defaultValue={values?.description ?? ''}
        />
      </Field>
      <Field id="event-mode" label={t('mode')}>
        <Select
          name="mode"
          value={mode}
          onValueChange={(next) => onModeChange(next === 'digital' ? 'digital' : 'physical')}
        >
          <SelectTrigger id="event-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="physical">{t('modePhysical')}</SelectItem>
            <SelectItem value="digital">{t('modeDigital')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="event-starts" label={t('startsAt')}>
          <Input
            id="event-starts"
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={values?.startsAt ?? ''}
          />
        </Field>
        <Field id="event-ends" label={t('endsAt')}>
          <Input
            id="event-ends"
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={values?.endsAt ?? ''}
          />
        </Field>
      </div>
      <Field id="event-timezone" label={t('timezone')}>
        <Input
          id="event-timezone"
          name="timezone"
          defaultValue={values?.timezone ?? 'Europe/Stockholm'}
        />
      </Field>

      {mode === 'physical' ? (
        <div className="flex flex-col gap-4 rounded-2xl bg-card p-4 text-card-foreground ring-1 ring-border">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('physicalDetails')}
          </p>
          <Field id="event-venue" label={t('venueName')}>
            <Input id="event-venue" name="venueName" defaultValue={values?.venueName ?? ''} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="event-lat" label={t('latitude')}>
              <Input
                id="event-lat"
                name="lat"
                type="number"
                defaultValue={values?.lat ?? ''}
                step="0.000001"
              />
            </Field>
            <Field id="event-lng" label={t('longitude')}>
              <Input
                id="event-lng"
                name="lng"
                type="number"
                defaultValue={values?.lng ?? ''}
                step="0.000001"
              />
            </Field>
          </div>
          <Field id="event-radius" label={t('geofenceRadiusM')}>
            <Input
              id="event-radius"
              name="geofenceRadiusM"
              type="number"
              defaultValue={values?.geofenceRadiusM ?? ''}
              min={10}
              max={5000}
            />
          </Field>
        </div>
      ) : (
        <Field id="event-online-url" label={t('onlineUrl')}>
          <Input
            id="event-online-url"
            name="onlineUrl"
            type="url"
            defaultValue={values?.onlineUrl ?? ''}
          />
        </Field>
      )}

      <Field id={categoriesInputId} label={t('tags')}>
        <select
          id={categoriesInputId}
          name="tagIds"
          multiple
          defaultValue={values?.tagIds ?? []}
          disabled={categoriesLoading || categoriesError}
          className="min-h-40 w-full rounded-lg border border-input bg-card px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {categories?.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/** Parse shared managed-event form fields into API-shaped values. */
export function readManagedEventForm(formData: FormData): {
  title: string;
  description: string;
  mode: EventMode;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venueName: string;
  location: { lat: number; lng: number } | undefined;
  geofenceRadiusM: number | undefined;
  onlineUrl: string | undefined;
  tagIds: string[];
} {
  const mode: EventMode =
    String(formData.get('mode') ?? 'physical') === 'digital' ? 'digital' : 'physical';
  const latRaw = String(formData.get('lat') ?? '').trim();
  const lngRaw = String(formData.get('lng') ?? '').trim();
  const radiusRaw = String(formData.get('geofenceRadiusM') ?? '').trim();
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? '').trim(),
    mode,
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    timezone: String(formData.get('timezone') ?? 'Europe/Stockholm'),
    venueName: String(formData.get('venueName') ?? '').trim(),
    location:
      mode === 'physical' && latRaw && lngRaw
        ? { lat: Number(latRaw), lng: Number(lngRaw) }
        : undefined,
    geofenceRadiusM: mode === 'physical' && radiusRaw ? Math.round(Number(radiusRaw)) : undefined,
    onlineUrl:
      mode === 'digital' ? String(formData.get('onlineUrl') ?? '').trim() || undefined : undefined,
    tagIds: formData.getAll('tagIds').map(String),
  };
}
