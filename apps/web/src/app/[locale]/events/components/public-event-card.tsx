import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { AppLink } from '@/components/app-link';

export type PublicEventCardData = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  mode: 'physical' | 'digital';
  venueName: string | null;
  onlineUrl: string | null;
};

type Props = {
  event: PublicEventCardData;
  locale: string;
  venueLabel: string;
  onlineLabel: string;
  missingVenue: string;
  missingUrl: string;
  readMoreLabel: string;
};

export function PublicEventCard({
  event,
  locale,
  venueLabel,
  onlineLabel,
  missingVenue,
  missingUrl,
  readMoreLabel,
}: Props) {
  return (
    <Card component="li" variant="outlined" sx={{ borderRadius: 2 }}>
      <CardActionArea component={AppLink} href={`/events/${event.id}`} aria-label={readMoreLabel}>
        <CardContent>
          <Typography variant="h6" component="h2">
            {event.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {new Date(event.startsAt).toLocaleString(locale)} -{' '}
            {new Date(event.endsAt).toLocaleString(locale)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {event.mode === 'physical'
              ? `${venueLabel}: ${event.venueName ?? missingVenue}`
              : `${onlineLabel}: ${event.onlineUrl ?? missingUrl}`}
          </Typography>
          <Typography variant="body2" color="primary" sx={{ mt: 1.5, fontWeight: 600 }}>
            {readMoreLabel}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
