import type { DuplicateSignal, MarketingPushPlanId, PublisherStatus, SourceTrust } from '@local-events/domain';
import type { TagChoice } from '@local-events/ingest';

/** Event text plus the organizer keys saved at import. The runner loads everything else. */
export interface ScanInput {
  eventId: string;
  title: string;
  description?: string;
  venue?: string;
  startsAt: string;
  endsAt: string;
  location?: { lat: number; lng: number };
  sourceUrl?: string;
  links: string[];
  pageLinks: { type: 'tickets' | 'registration' | 'info'; url: string }[];
  externalId: string;
  workerId: string;
  existingTags: TagChoice[];
  source: { id: string; slug: string; trust: SourceTrust };
  organizer: { keys: string[]; name?: string };
}

export type ChosenPublisher =
  | {
      kind: 'existing';
      publisherId: string;
      isTemporary: boolean;
      status: PublisherStatus;
      importNotificationPlan: MarketingPushPlanId | null;
    }
  | { kind: 'temporary'; name: string; organizerKeys: string[] };

export interface PossibleDuplicateMatch {
  eventId: string;
  title: string;
  startsAt: string;
  refId: string | null;
  workerId: string | null;
  matchedOn: DuplicateSignal;
}

export type ScanOutcome =
  | {
      ok: true;
      eventId: string;
      publisher: ChosenPublisher;
      duplicate: PossibleDuplicateMatch | null;
      /**
       * Duplicates the model ranked as another showing. The scan stores one
       * `meta.possibleOccasionGroupId` on this event and on each of these rows.
       */
      occasionMatches?: { eventId: string; occasionRank: number }[];
      /** Content scan. This step always approves. A later prompt can return false. */
      approved: boolean;
      tags: TagChoice[];
      contentVerdict: 'spam' | 'harmful' | 'safe' | 'unknown';
      llmOutput: object | null;
      summary: string;
      language: string;
      /** Steps from the description. Empty when the model listed none. */
      instructions: string[];
      /** Venue guesses. Empty when the model listed none. */
      possibleVenueNames?: { name: string; rank: number }[];
      /** Both set when the model found a range for an undated event. */
      startsAt?: string | null;
      endsAt?: string | null;
      /** Point geocoded from the address in the scan JSON. Set only when the event had none. */
      location?: { lat: number; lng: number };
      /** Address from the scan JSON, including the point when one was found. */
      address?: {
        address?: string;
        zipCode?: string;
        city?: string;
        country?: 'Sweden';
        location?: { lat: number; lng: number };
      };
    }
  | { ok: false; eventId: string; reason: 'unavailable' };

/** The temporary publisher and the event text the web lookup may use. */
export interface PublisherLookupInput {
  publisherId: string;
  name: string;
  publisherUrl?: string;
  organizerKeys: string[];
  title: string;
  description?: string;
  venue?: string;
  location?: { lat: number; lng: number };
}

/**
 * Facts from the publisher lookup. `website` is set only when a page on that
 * host was fetched. The scan stores this object on `publishers.meta.lookup`.
 */
export interface PublisherLookup {
  name: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  description: string | null;
  sources: { url: string }[];
}

/**
 * A finished lookup. `profile` is null when the chat found nothing.
 * `unavailable` means the model or the web search could not run, so the publisher stays `pending_scan`.
 */
export type PublisherLookupOutcome =
  | { ok: true; profile: PublisherLookup | null }
  | { ok: false; reason: 'unavailable' };

/**
 * Scans a batch. Each client decides how to look up publishers and duplicates,
 * and whether to walk the batch or send it as one job.
 * `lookupPublisher` runs from the publisher scan, after a temporary publisher exists.
 */
export interface PromptRunner {
  readonly id: string;
  scan(batch: ScanInput[]): Promise<ScanOutcome[]>;
  lookupPublisher(input: PublisherLookupInput): Promise<PublisherLookupOutcome>;
}
