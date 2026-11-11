'use client';

import { useTranslations } from 'next-intl';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { coordinateText, occasionOptionLabel } from './event-location';
import { EventLocationMap } from './event-location-map';

type OccasionPoint = {
  id: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  location: { lat: number; lng: number } | null;
};

export function LocationFields({
  occasions,
  timeZone,
  locale,
  occasionId,
  onOccasionId,
  radiusM,
  onRadius,
}: {
  occasions: OccasionPoint[];
  timeZone: string;
  locale: string;
  occasionId: string | null;
  onOccasionId: (id: string) => void;
  radiusM: string;
  onRadius: (value: string) => void;
}) {
  const t = useTranslations('EventEditor');
  const selected = occasions.find((item) => item.id === occasionId) ?? occasions[0] ?? null;
  const point = coordinateText(selected?.location);
  const lat = point.lat;
  const lng = point.lng;
  const labels = Object.fromEntries(
    occasions.map((occasion) => [occasion.id, occasionOptionLabel(occasion, timeZone, locale)]),
  );
  const caption = !selected
    ? t('noOccasions')
    : selected.location
      ? t('mapPinned')
      : t('mapNoPoint');

  return (
    <>
      {selected ? (
        <Field>
          <FieldLabel htmlFor="event-occasion">{t('mapOccasion')}</FieldLabel>
          <Select
            items={labels}
            value={selected.id}
            onValueChange={(next) => {
              if (typeof next === 'string') onOccasionId(next);
            }}
          >
            <SelectTrigger id="event-occasion" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {occasions.map((occasion) => (
                  <SelectItem key={occasion.id} value={occasion.id}>
                    {labels[occasion.id]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <EventLocationMap lat={lat} lng={lng} radiusM={radiusM} caption={caption} />
      <Field data-disabled>
        <FieldLabel htmlFor="event-venue">{t('venueName')}</FieldLabel>
        <Input id="event-venue" disabled value={selected?.venueName ?? ''} />
        <FieldDescription>{t('editOnOccasions')}</FieldDescription>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-disabled>
          <FieldLabel htmlFor="event-lat">{t('latitude')}</FieldLabel>
          <Input id="event-lat" disabled value={lat} />
          <FieldDescription>{t('pointOnOccasion')}</FieldDescription>
        </Field>
        <Field data-disabled>
          <FieldLabel htmlFor="event-lng">{t('longitude')}</FieldLabel>
          <Input id="event-lng" disabled value={lng} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="event-radius">{t('geofenceRadiusM')}</FieldLabel>
        <Input
          id="event-radius"
          inputMode="numeric"
          value={radiusM}
          onChange={(e) => onRadius(e.target.value)}
        />
      </Field>
    </>
  );
}
