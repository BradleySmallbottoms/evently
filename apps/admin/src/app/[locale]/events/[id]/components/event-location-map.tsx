'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { geofenceMeters, type EventLocationMapProps } from './event-location';

const LeafletMap = dynamic(
  () => import('./event-location-leaflet').then((mod) => mod.EventLocationLeaflet),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-muted" />,
  },
);

export function EventLocationMap(props: EventLocationMapProps) {
  const t = useTranslations('EventEditor');
  const idle = props.lat.trim() === '' && props.lng.trim() === '';
  return (
    <div className="flex flex-col gap-2">
      <div
        role="region"
        aria-label={t('mapLabel')}
        className="relative z-0 h-[360px] overflow-hidden rounded-md border"
      >
        <LeafletMap {...props} />
      </div>
      <p className="text-sm text-muted-foreground">
        {idle ? t('mapEmpty') : t('mapHint')}
        {geofenceMeters(props.radiusM) != null ? ` ${t('mapRadiusHint')}` : ''}
      </p>
    </div>
  );
}
