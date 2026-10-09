import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
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
    <Card component="li" variant="outlined">
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
        <Link
          component={AppLink}
          href={`/events/${event.id}`}
          underline="hover"
          variant="body2"
          sx={{ mt: 1.5, display: 'inline-block' }}
        >
          {readMoreLabel}
        </Link>
      </CardContent>
    </Card>
  );
}
