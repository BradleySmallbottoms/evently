import { AppLink } from '@/components/app-link';

export type PublicEventCardData = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  mode: 'physical' | 'digital';
  venueName: string | null;
  onlineUrl: string | null;
  imageUrl?: string | null;
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
    <li className="overflow-hidden rounded-2xl bg-card text-card-foreground ring-1 ring-border">
      <AppLink href={`/events/${event.id}`} aria-label={readMoreLabel} className="flex flex-col">
        {event.imageUrl ? (
          <img src={event.imageUrl} alt="" className="aspect-[16/10] w-full object-cover" />
        ) : null}
        <div className="flex flex-col gap-2 p-4">
          <h2 className="line-clamp-2 text-lg font-medium text-foreground">{event.title}</h2>
          <p className="text-sm text-muted-foreground">
            {new Date(event.startsAt).toLocaleString(locale)} -{' '}
            {new Date(event.endsAt).toLocaleString(locale)}
          </p>
          <p className="text-sm text-muted-foreground">
            {event.mode === 'physical'
              ? `${venueLabel}: ${event.venueName ?? missingVenue}`
              : `${onlineLabel}: ${event.onlineUrl ?? missingUrl}`}
          </p>
          <p className="text-sm font-semibold text-info">{readMoreLabel}</p>
        </div>
      </AppLink>
    </li>
  );
}
