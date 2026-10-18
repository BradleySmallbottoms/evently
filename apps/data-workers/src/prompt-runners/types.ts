import type { DuplicateSignal, MarketingPushPlanId, SourceTrust } from '@local-events/domain';
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
      verified: boolean;
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
    }
  | { ok: false; eventId: string; reason: 'unavailable' };

/**
 * Scans a batch. Each client decides how to look up publishers and duplicates,
 * and whether to walk the batch or send it as one job.
 */
export interface PromptRunner {
  readonly id: string;
  scan(batch: ScanInput[]): Promise<ScanOutcome[]>;
}
