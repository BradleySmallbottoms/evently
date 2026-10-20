'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { geofenceMeters, type EventLocationMapProps } from './event-location';

const LeafletMap = dynamic(
  () => import('./event-location-leaflet').then((mod) => mod.EventLocationLeaflet),
  {
    ssr: false,
    loading: () => <Box sx={{ height: '100%', bgcolor: 'action.hover' }} />,
  },
);

export function EventLocationMap(props: EventLocationMapProps) {
  const t = useTranslations('EventEditor');
  const idle = props.lat.trim() === '' && props.lng.trim() === '';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        role="region"
        aria-label={t('mapLabel')}
        sx={{
          height: 360,
          borderRadius: 1,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          position: 'relative',
          zIndex: 0,
        }}
      >
        <LeafletMap {...props} />
      </Box>
      <Typography variant="body2" color="text.secondary">
        {idle ? t('mapEmpty') : t('mapHint')}
        {geofenceMeters(props.radiusM) != null ? ` ${t('mapRadiusHint')}` : ''}
      </Typography>
    </Box>
  );
}
