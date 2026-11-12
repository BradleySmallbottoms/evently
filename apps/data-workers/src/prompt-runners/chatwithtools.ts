import { Id } from '@local-events/contracts';
import { type NearbyWindow } from '@local-events/geo';
import {
  ollamaBaseUrl,
  ollamaDisabled,
  ollamaModel,
  parseTagChoices,
  readScanInstructions,
  readScanOccasions,
  readScanRange,
  type LLMOutput,
  type LLMScanResult,
  type TagChoice,
  type TagMatchInput,
} from '@local-events/ingest';
import {
  createPublisherToolSession,
  executePublisherTool,
  PUBLISHER_LOOKUP_ROUNDS,
  publisherLookupPrompt,
  publisherProfileFromModel,
  publisherToolDefinitions,
  loadPublicHtml,
  pageFromHtml,
  type PublisherToolResult,
} from '../publisher-tools';
import { eventAddress, type EventAddressRecord } from '@local-events/domain';
import { lookupPageUrl, placesForName } from '../page-place';
import { MAX_SCAN_CONCURRENCY } from '../runpod-chat';
import { scanEventLines, scanPlaceLines } from '../scan-event-text';
import { beginScanProgress, finishScanProgress, type ScanProgress } from '../scan-progress';
import { LOCAL_ORGANIZER_SLUGS } from '../sources';
import {
  NEARBY_DAYS_AFTER,
  NEARBY_DAYS_BEFORE,
  publisherNameMatcher,
  type IngestStore,
  type NearbyEventHit,
  type NearbyPublisherHit,
  type PublisherCandidate,
  type PublisherRecord,
} from '../store';
import type {
  ChosenPublisher,
  PossibleDuplicateMatch,
  PromptRunner,
  ScanInput,
  ScanOutcome,
} from './types';

/** How long one chat request may run before the scan gives up on it. */
const CHAT_TIMEOUT_MS = 3 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Tool rounds for one event. The last round still has to be a text answer, or the scan is unavailable. Extra rounds cover getVenueFromName and geocodePlace when the source stored no point. */
const MAX_TOOL_ROUNDS = 14;
/** Title patterns one getEventsByName call may send. */
const EVENT_NAME_PATTERN_LIMIT = 5;
/** Longest date range getEventsByName accepts. */
const EVENT_NAME_RANGE_MS = 366 * DAY_MS;
/**
 * How many tool calls from one model reply are run. The scan prompt asks for all
 * tools one at a time. Claude rejects the next request when a `tool_use` has
 * no `tool_result`, so a call past this cap still gets an error result.
 */
const MAX_TOOL_CALLS_PER_ROUND = 8;

export interface OllamaWithToolsRunnerOptions {
  /**
   * Chat settings. With no `chatUrl`, the runner calls local Ollama at `/api/chat`.
   * `chatUrl` is the full endpoint. `chatAuth` is the header value (`Bearer …` is added
   * for `Authorization` when the value has no scheme). `chatAuthHeader` defaults to
   * `Authorization`, or `x-api-key` for Anthropic. The same names exist as `CHAT_URL`,
   * `CHAT_MODEL`, `CHAT_AUTH`, and `CHAT_AUTH_HEADER`. `CHAT_PROVIDER=chatgpt` uses
   * `OPENAI_API_KEY` and `https://api.openai.com/v1/chat/completions`. `CHAT_PROVIDER=claude`
   * uses `ANTHROPIC_API_KEY` and `https://api.anthropic.com/v1/messages`.
   */
  config?: Record<string, unknown>;
  /** Tests pass this so a scan does not call a running chat API. */
  fetch?: typeof fetch;
  /** Tests pass this so a publisher page fetch does not resolve DNS. */
  resolveHost?: (hostname: string) => Promise<string[]>;
  /** Tests pass this. Unset reads `BRAVE_API_KEY`. */
  braveApiKey?: string;
  /**
   * How many events in one batch may call the model at once. Writes still happen
   * after the batch, in order. `1` keeps the calls sequential.
   */
  concurrency?: number;
  /** Set by the RunPod scan so each event moves the live counts. */
  progress?: ScanProgress;
}

type ChatProtocol = 'ollama' | 'openai' | 'anthropic';

/** One configured chat endpoint. `headers` already includes auth and never includes the URL userinfo. */
interface ChatEndpoint {
  url: URL;
  model: string;
  protocol: ChatProtocol;
  headers: Record<string, string>;
}

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Assistant turn in the shape that provider expects to see again, plus the calls to run. */
interface AssistantTurn {
  wire: Record<string, unknown>;
  text: string;
  calls: ParsedToolCall[];
}

/** Everything a tool needs besides the arguments the model sent. */
interface LookupContext {
  store: IngestStore;
  event: ScanInput;
  catalog: TagChoice[];
  /** Fetch for the ticket or info page. The model never supplies the URL. */
  fetch?: typeof fetch;
  /** Resolves a hostname to addresses for the public-host check. */
  resolveHost?: (hostname: string) => Promise<string[]>;
  /** Places from geocodePlace. A chosen point becomes the base for the other tools. */
  placeSearch?: PlaceSearch;
  /** Venue points returned by getVenueFromName. The model can adopt one by id. */
  venuePoints?: Map<string, { lat: number; lng: number }>;
  /** Name lookups already spent. An exact name is first, then one wildcard. */
  venueLookups?: number;
  /** Venue id adopted by getVenueFromName. */
  chosenVenueId?: string;
}

const GEOCODE_CALLS = 2;

interface PlaceSearch {
  calls: number;
  nextId: number;
  byId: Map<string, { label: string; lat: number; lng: number }>;
  chosen?: { lat: number; lng: number };
}

type ToolResult =
  | { error: string }
  | { events: NearbyEventHit[] }
  | { publishers: NearbyPublisherHit[] }
  | { possiblePublishers: PublisherCandidate[] }
  | {
      venues: {
        id: string;
        name: string;
        city: string;
        address: string | null;
        distanceM?: number;
      }[];
    }
  | { tags: { id: string; name: string }[] }
  | { places: { id: string; label: string }[] }
  | { using: true; placeId: string; venueId?: string }
  | PublisherToolResult;

/**
 * Tools offered on every chat call. The provider does not run them; the runner does.
 * OpenAI and Ollama share this shape. Anthropic is mapped in {@link anthropicToolDefinitions}.
 * Radius, time window, and row cap are described here and enforced in the lookups.
 */
function chatToolDefinitions(event: ScanInput): object[] {
  const noArguments = { type: 'object', properties: {} };
  const tools: object[] = [
    {
      type: 'function',
      function: {
        name: 'getNearbyEvents',
        description:
          'Events within 500 m of the event being scanned. Their start is from 1 day before that event through 1 day after. Cancelled and ended events are left out. Takes no arguments; the event point is used.',
        parameters: noArguments,
      },
    },
    {
      type: 'function',
      function: {
        name: 'getEventsByName',
        description:
          'Events whose title matches a wildcard and that have a showing starting between from and to, within 50 km of the event being scanned. * matches any text and ? matches one character. Cancelled, ended, and deleted events are left out. Call this only after the publisher and the showings are decided, and only when getNearbyEvents found no duplicate.',
        parameters: {
          type: 'object',
          properties: {
            names: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Title patterns taken from the event name. Use * for any text and ? for one character, for example Julmarknad* or Konsert i *.',
            },
            from: {
              type: 'string',
              description:
                'Start of the date range, ISO-8601. A showing must start at or after this instant.',
            },
            to: {
              type: 'string',
              description:
                'End of the date range, ISO-8601. A showing must start at or before this instant.',
            },
          },
          required: ['names', 'from', 'to'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getVenuesByName',
        description:
          'Venues whose name matches, within 50 km of the event being scanned. * matches any text and ? matches one character. Each venue includes its id, name, city, street, and distance in meters. Call this with the venue name, not the street and not the town.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Venue name. Use * for any text and ? for one character, for example Biografen*.',
            },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getNearbyPublishers',
        description:
          'Publishers that have an event within 500 m of the event being scanned, in that same time window. Takes no arguments; the event point is used.',
        parameters: noArguments,
      },
    },
    {
      type: 'function',
      function: {
        name: 'getPublishersByName',
        description:
          'Publishers whose name matches. * matches any text and ? matches one character. Only publishers with an event within 50 km of the event being scanned are returned.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Publisher name. Use * for any text and ? for one character, for example Hälsing*.',
            },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getPossiblePublishers',
        description:
          'Publishers that match the organizer keys of the event being scanned. Distance in meters to the closest event from the scanned event is included. Takes no arguments.',
        parameters: noArguments,
      },
    },
    {
      type: 'function',
      function: {
        name: 'getAvailableTags',
        description:
          'The tag catalog. Call this before choosing tags. Only ids from this list may be used. Takes no arguments.',
        parameters: noArguments,
      },
    },
  ];
  if (eventPageUrl(event)) {
    tools.push({
      type: 'function',
      function: {
        name: 'fetchEventPage',
        description:
          'Fetch the one event page. Takes no arguments. That page is the source URL, or else a ticket page, an info page, or a Facebook page, in that order. Use the page text for tags, instructions, the summary, the address, a venue name, and every showing. A page can name more than one showing. Returns the page title and text.',
        parameters: noArguments,
      },
    });
  }
  if (!event.location) {
    tools.push({
      type: 'function',
      function: {
        name: 'getVenueFromName',
        description:
          'Look up a stored venue by name when this event has no point. Call it first with the exact name. If that returns none, call it once more with * and ?. * matches any text and ? matches one character. Call it again with use set to a returned venue id to take that venue’s point. Call this before geocodePlace.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'The venue name. The first call is the exact name. The second call may use * and ?.',
            },
            use: {
              type: 'string',
              description: 'Id of a venue returned by an earlier call. Sets that venue’s point.',
            },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'geocodePlace',
        description:
          'Look up a place by the name you choose when this event has no point. Returns places with ids. Call it again with use set to the id of the place for this event. That point is then used by the other tools. You may look up a name twice.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The place name to look up, such as a venue or a street and town.',
            },
            use: {
              type: 'string',
              description:
                'Id of a place returned by an earlier call. Sets that point for the other tools.',
            },
          },
        },
      },
    });
  }
  return tools;
}

/** The one page this scan may open. */
function eventPageUrl(event: ScanInput): string | undefined {
  return lookupPageUrl(event.pageLinks, event.sourceUrl);
}

/**
 * Scans a batch with tool calling. Same result shape as the plain Ollama runner:
 * the model may look up events, publishers, and tags, and code still picks the
 * publisher and the duplicate.
 */
export function createOllamaWithToolsPromptRunner(
  store: IngestStore,
  options: OllamaWithToolsRunnerOptions = {},
): PromptRunner {
  const config = options.config ?? {};
  const fetchImpl = options.fetch ?? fetch;
  return {
    id: 'ollama-with-tools',
    /**
     * The tag catalog is loaded once. Events run `concurrency` at a time. Each
     * event still walks its own tool rounds one after another. The result order
     * matches the batch.
     */
    async scan(batch) {
      const catalog = (await store.listTags()).map((tag) => ({
        externalId: tag.externalId,
        name: tag.name,
      }));
      const concurrency = Math.min(MAX_SCAN_CONCURRENCY, Math.max(1, options.concurrency ?? 1));
      const progress = options.progress;
      return mapPool(batch, concurrency, async (event) => {
        if (progress) beginScanProgress(progress);
        const outcome = await scanOneEvent(
          event,
          {
            store,
            event,
            catalog,
            fetch: fetchImpl,
            ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
          },
          config,
          fetchImpl,
        ).catch((error: unknown) => {
          console.error(
            'scan failed',
            event.eventId,
            error instanceof Error ? error.message : error,
          );
          return { ok: false as const, eventId: event.eventId, reason: 'unavailable' as const };
        });
        if (progress) finishScanProgress(progress, outcome.ok);
        return outcome;
      });
    },
    /**
     * A second chat, after a temporary publisher exists. Only the web tools are
     * offered. A missing key or a failed call is unavailable. A finished chat
     * with no facts returns a null profile.
     */
    async lookupPublisher(input) {
      const braveApiKey =
        options.braveApiKey !== undefined
          ? options.braveApiKey.trim()
          : (process.env.BRAVE_API_KEY?.trim() ?? '');
      if (!braveApiKey) return { ok: false, reason: 'unavailable' };
      const session = createPublisherToolSession();
      const finished = await runToolChat(
        publisherLookupPrompt(input),
        publisherToolDefinitions(),
        async (call) => {
          return executePublisherTool(call.name, call.arguments, session, {
            fetch: fetchImpl,
            ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
            braveApiKey,
          });
        },
        config,
        fetchImpl,
        PUBLISHER_LOOKUP_ROUNDS,
      );
      if (finished === 'timeout' || !finished) return { ok: false, reason: 'unavailable' };
      return { ok: true, profile: publisherProfileFromModel(finished.text, session.fetchedUrls) };
    },
  };
}

/**
 * Runs `fn` on up to `limit` items at once. The index increment happens before the
 * first await, so two workers cannot take the same item. Results keep input order.
 */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Asks the model, then resolves the publisher and duplicate in code.
 * No organizer key means there is nothing to attach, so the model is not called.
 * A failed model call leaves the row for a later scan.
 */
async function scanOneEvent(
  event: ScanInput,
  context: LookupContext,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<ScanOutcome> {
  if (event.organizer.keys.length === 0) {
    return { ok: false, eventId: event.eventId, reason: 'unavailable' };
  }
  if (!event.location) {
    context.placeSearch = { calls: 0, nextId: 1, byId: new Map() };
    context.venuePoints = new Map();
    context.venueLookups = 0;
  }

  const content = await askModelWithLookups(buildScanPrompt(event), context, config, fetchImpl);
  if (content === 'timeout' || !content) {
    return {
      ok: false,
      eventId: event.eventId,
      reason: content === 'timeout' ? 'timeout' : 'unavailable',
    };
  }
  return scanOutcomeFromContent(event, content, {
    store: context.store,
    catalog: context.catalog,
    ...(context.placeSearch?.chosen ? { chosenPoint: context.placeSearch.chosen } : {}),
    ...(context.chosenVenueId ? { chosenVenueId: context.chosenVenueId } : {}),
  });
}

export async function scanOutcomeFromContent(
  event: ScanInput,
  content: LLMScanResult & LLMOutput,
  context: Pick<LookupContext, 'store' | 'catalog'> & {
    chosenPoint?: { lat: number; lng: number };
    chosenVenueId?: string;
  },
): Promise<Extract<ScanOutcome, { ok: true }>> {
  const tags =
    context.catalog.length > 0 ? parseTagChoices(content, context.catalog) : event.existingTags;
  const lookupContext: LookupContext = { ...context, event };
  const publisher = await bestPublisher(content, lookupContext);
  const duplicate = await bestDuplicate(content, lookupContext);
  const occasionMatches = content.possibleDuplicates.flatMap((item) =>
    typeof item.occasionRank === 'number'
      ? [{ eventId: item.eventId, occasionRank: item.occasionRank }]
      : [],
  );
  return {
    ok: true,
    eventId: event.eventId,
    publisher: publisher ?? {
      kind: 'temporary',
      name: event.organizer.name?.trim() || event.organizer.keys[0] || event.title,
      organizerKeys: event.organizer.keys,
    },
    duplicate,
    occasionMatches,
    approved: true,
    tags,
    contentVerdict: content.contentVerdict,
    summary: content.summary,
    language: content.language,
    instructions: content.instructions,
    possibleVenueNames: content.possibleVenueNames,
    possibleVenues: content.possibleVenues,
    possibleOccasions: content.possibleOccasions,
    startsAt: content.startsAt,
    endsAt: content.endsAt,
    ...(content.address ? { address: content.address } : {}),
    ...(context.chosenPoint ? { chosenPoint: context.chosenPoint } : {}),
    ...(context.chosenVenueId ? { chosenVenueId: context.chosenVenueId } : {}),
    llmOutput: content.output,
  };
}

async function bestPublisher(
  content: LLMScanResult & LLMOutput,
  context: LookupContext,
): Promise<ChosenPublisher | null> {
  if (content.possiblePublishers.length === 0) return null;
  // by rank
  const bestMatch = content.possiblePublishers.sort((a, b) => a.rank - b.rank)[0];
  if (!bestMatch) return null;
  if (!Id.safeParse(bestMatch.publisherId).success) return null;
  const publisher = await context.store.getPublisher(bestMatch.publisherId);
  if (!publisher) return null;
  return {
    kind: 'existing',
    publisherId: publisher.id,
    isTemporary: publisher.isTemporary,
    status: publisher.status,
    importNotificationPlan: publisher.importNotificationPlan,
    importNotifyOnPublish: publisher.importNotifyOnPublish,
  };
}

async function bestDuplicate(
  content: LLMScanResult & LLMOutput,
  context: LookupContext,
): Promise<PossibleDuplicateMatch | null> {
  if (content.possibleDuplicates.length === 0) return null;
  // by rank
  const bestMatch = content.possibleDuplicates.sort((a, b) => a.rank - b.rank)[0];
  if (!bestMatch || !Id.safeParse(bestMatch.eventId).success) return null;
  const event = await context.store.getEvent(bestMatch.eventId);
  if (!event) return null;
  return {
    eventId: event.eventId,
    title: event.title,
    startsAt: event.startsAt,
    refId: event.refId,
    workerId: event.workerId,
    matchedOn: 'llm',
  };
}

/**
 * Tells the model which tools exist and which JSON object to return when it is done.
 * Nearby tools take no coordinates; they use this event's point. The tag catalog is
 * not inlined; the model calls getAvailableTags for that.
 */
function buildScanPrompt(event: ScanInput): string {
  const place = event.location ? `lat ${event.location.lat}, lng ${event.location.lng}` : 'none';
  const publisherName = event.organizer.name?.trim() || '';
  const namePattern = publisherName ? `${publisherName.split(/\s+/)[0]}*` : '';
  return [
    'You scan one imported event for spam, language, tags, a short summary, the publisher, and a duplicate.',
    'Call one tool, wait for its result, then decide the next step. Do not return JSON in the same turn as a tool call.',
    'Never invent a publisher id, an event id, a venue id, or a tag id. Every id in the JSON must come from a tool result.',
    '1. Call getAvailableTags(). This call is required and can never be skipped. Tags may only use ids from that list. Score every tag from 0 to 100 and order them by highest score. Return at most 3 tags.',
    '2. Call getPossiblePublishers() before you match a publisher. Each returned publisher has a name and one or more organizer keys and dinstance in meter to the closest event from this event.',
    'Use the possible publishers name to rate how plausible it that this publisher has events like this event.',
    'Consider distanceMeters when deciding if a publisher is a reasonable match, events from the same publisher should be close to each other, less than 250 meters is a good match.',
    'If unsure try matching at least one organizer key to the scanned event',
    'Do not include keys like "domain.com" in the publisher match, only include keys like full website urls, names and addresses."',
    namePattern
      ? `3. If that list has no reasonable match, call getPublishersByName with name "${namePattern}". * matches any text and ? matches one character.`
      : '',
    //'3. If that list has no reasonable match, call getPublishersByName with the publisher name below and * after its first word.',
    '4. If the name list also has no reasonable match, call getNearbyPublishers().',
    '5. If the nearby list also has no reasonable match, possiblePublishers is []. That is allowed. A made-up publisher is not.',
    'Stop the publisher search at the first list that has a reasonable match. Include a publisher only when its rank is over 90. A empty list is allowed.',
    'Use the title, location, and description for the content verdict: "spam", "harmful", or "safe". When the event has a Tip chat section, use those chat lines as well.',
    'Write a short and brief summary in the language of the event. Do not include the city name. A venue is fine when it matters.',
    'instructions are steps a visitor follows, taken only from the description or the event page, such as what to bring or how to sign up. Use an empty list when the text has no such steps.',
    'The Tip chat section is the chat with the person who submitted the event. Lines such as "place: ...", "link: ...", and "confirm: place" are that chat. Do not turn them into instructions. Do not write a step that asks anyone to confirm the place, the link, the description, or any other field.',
    'Read the title, the description, and the event page and list every showing in possibleOccasions. A description can name more than one showing or a range of dates, a range of dates should be returned as a single showing. If a year is missing from the date or date range, assume this year unless the date is in the future, then assume next year. Return each one you can read. Do not invent a showing.',
    ...(eventPageUrl(event)
      ? [
          `Page: ${eventPageUrl(event)}`,
          'Call fetchEventPage before you choose tags, instructions, the summary, or showings. The tool takes no arguments.',
          'Use the page text together with the title and description. Tags still have to be ids from getAvailableTags.',
          'Use the page for showings and for the address. A page can name more than one showing.',
        ]
      : []),
    'List possible venue names from the title, description, and event page. A venue is the place where the event happens, not the city and not the organizer.',
    'Call getVenuesByName before you decide the venue. * matches any text and ? matches one character. Search the venue name, not the street and not the town. You may call it again with another pattern.',
    'Return possibleVenues as objects with venueId and rank from 0 to 100. Include a venue only when its rank is over 90. The venueId must come from getVenuesByName or getVenueFromName. An empty list is allowed.',
    'A rank over 90 uses that stored venue and its point. When this event has no point and neither getVenueFromName nor geocodePlace chose one, the address in the JSON is geocoded.',
    ...(event.location
      ? []
      : [
          "This event has no point. Call getVenueFromName with the exact venue name before geocodePlace. If that returns none, call it once more with * and ?. * matches any text and ? matches one character. When several towns share that name, use the venue in this event's town. Call it again with use set to that venue id, and return that venue in possibleVenues with a rank over 90. That point is then used by the other tools. If both lookups return none, call geocodePlace with the place name you choose. You may call geocodePlace twice. Call it again with use set to the id of the place for this event. Do not invent a venue id or a place id.",
        ]),
    'Return possibleVenueNames as objects with name and rank from 0 to 100. Include a name only when the rank is over 50.',
    'Read the Place line, the description, and the event page and extract the street, postcode, and city into address.',
    'A Place line can mix a venue name, a street and house number, and a town. Split it. "Röda Kvarn Ljusdal, Norra Järnvägsgatan 17 Ljusdal" is venue Röda Kvarn, street Norra Järnvägsgatan 17, and city Ljusdal.',
    'address.address is only the street and house number. address.city is the town. Put the venue in possibleVenueNames, not in the street. The town written beside the venue is not part of the venue name.',
    'When that line contains a street and a house number, parse it and rank the address over 80. Do this even when a point is already stored.',
    'Add rank from 0 to 100 for how sure that address is the place of this event. A rank over 80 replaces an address and a point already stored.',
    'Use null when the Place line, the description, and the page contain no street and no town. Do not invent an address or coordinates.',
    'Each showing has startsAt, endsAt, and venueName. venueName is the place for that showing, or null when the text names none.',
    'Return both times as ISO-8601 datetimes with a numeric offset. When the text names no time zone, use Europe/Stockholm.',
    'A date with no clock is that whole day: start at 00:00:00 and end at 23:59:59.',
    'Use an empty possibleOccasions list when you cannot find both a start and an end for any showing. When Starts and Ends are already set, include that showing too when the text confirms it.',
    'After the publisher and the showings are decided, call getNearbyEvents(). This call is required. Compare the scanned event with each event in the result.',
    'Rank the match from 0 to 100 and return only a duplicate if the rank is over 90.',
    'For every possible duplicate, rank how likely it is another occasion of the same event from 0 to 100. Another occasion is when the title, location, and description are similar but dates are different.',
    'If getNearbyEvents has no duplicate you would rank over 90, call getEventsByName. Do not call it when a duplicate was already found.',
    'Choose the names yourself from this event title. * matches any text and ? matches one character. Each pattern needs a letter or number. Pass at most 5 patterns.',
    'Pass from and to as ISO-8601 datetimes that cover the showings you found. When you found no showing, cover this event start and end. The range may not be longer than one year.',
    'Use those events the same way. Add one to possibleDuplicates only when its rank is over 90.',
    'contentVerdict is "spam", "harmful", or "safe". language is the event language, such as "sv" or "en". rank and score are numbers from 0 to 100.',
    'Include a explanation of why tags where chosed and why the publisher and duplicate were chosen etc. in the JSON object.',
    'When you are finished, return only the JSON object. Do not explain it and do not wrap it in markdown:',
    '{"decision_explanation": "<decision_explanation>", "instructions":[],"possiblePublishers":[{"publisherId":"<publisherId>","rank":95}],"possibleDuplicates":[{"eventId":"<eventId>","rank":95,"occasionRank":10}],"contentVerdict":"safe","summary":"<summary>","language":"sv","possibleTags":[{"id":"<id>","score":95}],"possibleOccasions":[{"startsAt":"2026-11-14T19:00:00+01:00","endsAt":"2026-11-14T21:00:00+01:00","venueName":"Svea Bio"},{"startsAt":"2026-11-21T19:00:00+01:00","endsAt":"2026-11-21T21:00:00+01:00","venueName":null}],"address":{"address":"Köpmangatan 14","zipCode":"82471","city":"Delsbo","rank":95},"possibleVenueNames":[{"name":"Svea Bio","rank":95}],"possibleVenues":[{"venueId":"<venueId>","rank":95}]}',
    'Event:',
    `Title: ${event.title}`,
    `Starts: ${event.startsAt || '(missing)'}`,
    `Ends: ${event.endsAt || '(missing)'}`,
    `Publisher name: ${event.organizer.name}`,
    'Publisher keys:',
    ...event.organizer.keys.map((key) => `- ${key}`),
    `Point: ${place}`,
    ...(event.venue ? [`Location: ${event.venue}`] : []),
    ...scanPlaceLines(event),
    ...scanEventLines(event),
  ].join('\n');
}

/**
 * Posts the prompt, runs any tool calls, and posts again until the model returns
 * text or the round cap is hit. `format: json` is left off so tool calls are not
 * forced into a text body. The final text is parsed as the scan JSON.
 */
async function askModelWithLookups(
  prompt: string,
  context: LookupContext,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<(LLMScanResult & LLMOutput) | 'timeout' | null> {
  const offeredVenueIds = new Set<string>();
  const finished = await runToolChat(
    prompt,
    chatToolDefinitions(context.event),
    async (call) => {
      const result = await executeToolCall(call, context);
      if (
        (call.name === 'getVenuesByName' || call.name === 'getVenueFromName') &&
        'venues' in result &&
        Array.isArray(result.venues)
      ) {
        for (const venue of result.venues) offeredVenueIds.add(venue.id);
      }
      return result;
    },
    config,
    fetchImpl,
    MAX_TOOL_ROUNDS,
  );
  if (finished === 'timeout') return 'timeout';
  if (!finished) return null;
  const parsed = parseScanJson(finished.text);
  if (!parsed) return null;
  return {
    ...parsed,
    possibleVenues: parsed.possibleVenues.filter(
      (venue) => Id.safeParse(venue.venueId).success && offeredVenueIds.has(venue.venueId),
    ),
    output: finished.output,
  };
}

/**
 * Posts the prompt, runs any tool calls, and posts again until the model returns
 * text or the round cap is hit. `tools` is what that chat may call.
 */
async function runToolChat(
  prompt: string,
  tools: object[],
  execute: (call: ParsedToolCall) => Promise<ToolResult>,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
  maxRounds: number,
): Promise<{ text: string; output: object } | 'timeout' | null> {
  const endpoint = resolveChatEndpoint(config);
  if (!endpoint) return null;
  if (endpoint.protocol === 'ollama' && ollamaDisabled()) return null;
  const messages: Record<string, unknown>[] = [{ role: 'user', content: prompt }];
  const toolLookups: string[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const payload = await postChat(endpoint, messages, round, fetchImpl, tools);
    if (payload === 'timeout') return 'timeout';
    if (!payload) return null;
    const turn = readAssistantTurn(endpoint.protocol, payload);
    const calls = turn?.calls.slice(0, MAX_TOOL_CALLS_PER_ROUND) ?? [];
    if (!turn || calls.length === 0) {
      if (!turn || turn.text.length === 0) return null;
      return { text: turn.text, output: withToolLookups(payload, toolLookups) };
    }
    const results: ToolResult[] = [];
    for (const call of calls) {
      const result = await execute(call);
      results.push(result);
      toolLookups.push(toolLookupLine(call, result));
    }
    appendToolResults(endpoint.protocol, messages, turn.wire, calls, results);
  }
  return null;
}

/** The page body stays in the tool result. The scan log only keeps this short line. */
function toolLookupLine(call: ParsedToolCall, result: ToolResult): string {
  const detail = toolArgumentText(call.arguments);
  const name = detail ? `${call.name} ${detail}` : call.name;
  return `${name}. ${toolResultText(result)}`;
}

function withToolLookups(payload: object, toolLookups: string[]): object {
  if (toolLookups.length === 0) return payload;
  return { ...payload, toolLookups };
}

function toolArgumentText(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      const text = value.replace(/\s+/g, ' ').trim();
      if (text && text.length <= 80) parts.push(`${key}=${text}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    } else if (Array.isArray(value)) {
      const items = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.replace(/\s+/g, ' ').trim())
        .filter((item) => item.length > 0 && item.length <= 40)
        .slice(0, 5);
      if (items.length > 0) parts.push(`${key}=${items.join('|')}`);
    }
  }
  return parts.join(', ');
}

function toolResultText(result: ToolResult): string {
  if ('error' in result && typeof result.error === 'string') {
    return `Result: ${result.error.replace(/\s+/g, ' ').trim().slice(0, 80)}`;
  }
  if ('text' in result && 'url' in result && typeof result.url === 'string') {
    const count = Array.isArray(result.events) ? result.events.length : 0;
    return `Result: opened ${result.url.slice(0, 120)}, ${count} events on the page.`;
  }
  if ('events' in result && Array.isArray(result.events)) {
    return `Result: ${result.events.length} events.`;
  }
  if ('publishers' in result && Array.isArray(result.publishers)) {
    return `Result: ${result.publishers.length} publishers.`;
  }
  if ('possiblePublishers' in result && Array.isArray(result.possiblePublishers)) {
    return `Result: ${result.possiblePublishers.length} publishers.`;
  }
  if ('venues' in result && Array.isArray(result.venues)) {
    return `Result: ${result.venues.length} venues.`;
  }
  if ('tags' in result && Array.isArray(result.tags)) return `Result: ${result.tags.length} tags.`;
  if ('places' in result && Array.isArray(result.places)) {
    const labels = result.places.map((place) => `${place.id} ${place.label}`).join('; ');
    return `Result: ${result.places.length} places. ${labels}`.slice(0, 240);
  }
  if ('using' in result && result.using) {
    return `Result: using ${'venueId' in result ? 'venue' : 'place'} ${result.placeId}.`;
  }
  if ('results' in result && Array.isArray(result.results)) {
    return `Result: ${result.results.length} web results.`;
  }
  return 'Result: done.';
}

/**
 * Qwen3 thinks unless the request turns that off, and greedy decoding makes it repeat.
 * Other OpenAI-compatible models stay at temperature 0.
 */
function openAiSampling(model: string): Record<string, unknown> {
  if (!/qwen3/i.test(model)) return { temperature: 0 };
  return {
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    chat_template_kwargs: { enable_thinking: false },
  };
}

/** Built-in ChatGPT and Claude endpoints. A custom `chatUrl` still overrides the URL. */
const CHAT_PROVIDERS = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4.1-mini',
    authConfig: 'openaiApiKey',
    authEnv: 'OPENAI_API_KEY',
    modelConfig: 'openaiModel',
    modelEnv: 'OPENAI_MODEL',
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-5-5',
    authConfig: 'anthropicApiKey',
    authEnv: 'ANTHROPIC_API_KEY',
    modelConfig: 'anthropicModel',
    modelEnv: 'ANTHROPIC_MODEL',
  },
} as const;

type NamedChatProvider = keyof typeof CHAT_PROVIDERS;

/**
 * Reads the chat settings from config, then the environment. `CHAT_PROVIDER=chatgpt`
 * uses OpenAI's chat completions URL and `OPENAI_API_KEY`. `CHAT_PROVIDER=claude` uses
 * Anthropic's messages URL and `ANTHROPIC_API_KEY`. No provider and no URL means local
 * Ollama `/api/chat`. `http` is only allowed on loopback. A URL with a username or
 * password is rejected so the secret stays in the auth header. A named provider with
 * no key does not fall back to Ollama.
 */
function resolveChatEndpoint(config: Record<string, unknown>): ChatEndpoint | null {
  const named = namedChatProvider(config);
  if (named === 'invalid') return null;
  const provider = named === 'ollama' || named === 'unset' ? null : CHAT_PROVIDERS[named];
  const rawUrl = configString(config, 'chatUrl', 'CHAT_URL') || provider?.url || '';
  let url: URL;
  try {
    url = rawUrl ? new URL(rawUrl) : new URL('/api/chat', ollamaBaseUrl(config));
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const loopback = isLoopback(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;

  const protocol = chatProtocol(url);
  const configuredModel = configString(config, 'chatModel', 'CHAT_MODEL');
  const providerModel = provider
    ? configString(config, provider.modelConfig, provider.modelEnv)
    : '';
  let model = configuredModel || providerModel || provider?.defaultModel || '';
  if (!model) {
    try {
      model = ollamaModel(config);
    } catch {
      return null;
    }
  }
  if (!/^[\w./:-]{1,120}$/.test(model)) return null;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const providerAuth = provider ? configString(config, provider.authConfig, provider.authEnv) : '';
  const auth = configString(config, 'chatAuth', 'CHAT_AUTH') || providerAuth;
  if (provider && !auth) return null;
  const headerName =
    configString(config, 'chatAuthHeader', 'CHAT_AUTH_HEADER') ||
    (protocol === 'anthropic' ? 'x-api-key' : 'Authorization');
  if (auth) headers[headerName] = authorizationValue(headerName, auth);
  if (protocol === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  return { url, model, protocol, headers };
}

/**
 * `chatgpt` and `openai` share one endpoint. `claude` and `anthropic` share the other.
 * `ollama` keeps the local server. An empty value means no named provider. Anything else
 * is invalid, so the scan does not guess.
 */
function namedChatProvider(
  config: Record<string, unknown>,
): NamedChatProvider | 'ollama' | 'unset' | 'invalid' {
  const raw = configString(config, 'chatProvider', 'CHAT_PROVIDER').toLowerCase();
  if (!raw) return 'unset';
  if (raw === 'openai' || raw === 'chatgpt') return 'openai';
  if (raw === 'anthropic' || raw === 'claude') return 'anthropic';
  if (raw === 'ollama') return 'ollama';
  return 'invalid';
}

/** Config string, otherwise the environment variable. Blank is empty. */
function configString(config: Record<string, unknown>, key: string, envName: string): string {
  const fromConfig = config[key];
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
  return process.env[envName]?.trim() ?? '';
}

/** True for the hosts the Ollama helper already treats as this machine. */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Which request body to send. Path wins over the host, so Ollama's OpenAI-compatible
 * `/v1/chat/completions` is spoken as OpenAI.
 */
function chatProtocol(url: URL): ChatProtocol {
  const path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/api/chat')) return 'ollama';
  if (url.hostname.toLowerCase() === 'api.anthropic.com' || path.endsWith('/messages'))
    return 'anthropic';
  return 'openai';
}

/** `Authorization` without a scheme becomes `Bearer`. Other headers are sent as given. */
function authorizationValue(headerName: string, auth: string): string {
  if (headerName.toLowerCase() !== 'authorization' || auth.includes(' ')) return auth;
  return `Bearer ${auth}`;
}

/** Anthropic tools use `input_schema` instead of the OpenAI `function.parameters` wrapper. */
function anthropicToolDefinitions(tools: object[]): object[] {
  const defined: object[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object' || !('function' in tool)) continue;
    const fn = tool.function;
    if (!fn || typeof fn !== 'object') continue;
    const name = 'name' in fn && typeof fn.name === 'string' ? fn.name : '';
    const description =
      'description' in fn && typeof fn.description === 'string' ? fn.description : '';
    const parameters = 'parameters' in fn ? fn.parameters : { type: 'object', properties: {} };
    if (!name) continue;
    defined.push({ name, description, input_schema: parameters });
  }
  return defined;
}

/**
 * One non-streaming chat request. Ollama keeps its `/api/chat` body. OpenAI and ChatGPT
 * use chat completions. Claude uses the Messages API. Current Claude models reject
 * `temperature`, so that field is left off. A non-OK response returns null. A timeout returns `timeout`.
 * The auth header is not written to the log.
 */
async function postChat(
  endpoint: ChatEndpoint,
  messages: Record<string, unknown>[],
  round: number,
  fetchImpl: typeof fetch,
  tools: object[],
): Promise<object | 'timeout' | null> {
  const body =
    endpoint.protocol === 'ollama'
      ? {
          model: endpoint.model,
          thinks: round > 0,
          stream: false,
          options: { temperature: 0 },
          ...(tools.length > 0 ? { tools } : {}),
          messages,
        }
      : endpoint.protocol === 'anthropic'
        ? {
            model: endpoint.model,
            max_tokens: 4096,
            ...(tools.length > 0 ? { tools: anthropicToolDefinitions(tools) } : {}),
            messages,
          }
        : {
            model: endpoint.model,
            stream: false,
            ...(tools.length > 0 ? { tools } : {}),
            messages,
            ...openAiSampling(endpoint.model),
          };
  try {
    const response = await fetchImpl(endpoint.url, {
      method: 'POST',
      redirect: 'error',
      headers: endpoint.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      console.log('response', endpoint.protocol, response.status);
      return null;
    }
    return payload && typeof payload === 'object' ? payload : null;
  } catch (error) {
    if (chatTimedOut(error)) {
      console.log('chat timed out', endpoint.protocol);
      return 'timeout';
    }
    return null;
  }
}

export interface ChatImage {
  mediaType: string;
  base64: string;
}

/**
 * One chat turn that includes a photo. Uses the same endpoint as the import scan.
 * A missing endpoint, a disabled local model, or an empty answer returns null.
 */
export async function completeChatImage(
  config: Record<string, unknown>,
  prompt: string,
  image: ChatImage,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; output: object } | 'timeout' | null> {
  const endpoint = resolveChatEndpoint(config);
  if (!endpoint) return null;
  if (endpoint.protocol === 'ollama' && ollamaDisabled()) return null;
  const payload = await postChat(
    endpoint,
    [imageUserMessage(endpoint.protocol, prompt, image)],
    0,
    fetchImpl,
    [],
  );
  if (payload === 'timeout' || !payload) return payload;
  const turn = readAssistantTurn(endpoint.protocol, payload);
  if (!turn || turn.text.length === 0) return null;
  return { text: turn.text, output: payload };
}

/** True when the scan chat endpoint can be called. A named provider still needs its key. */
export function hasChatEndpoint(config: Record<string, unknown> = {}): boolean {
  const endpoint = resolveChatEndpoint(config);
  if (!endpoint) return false;
  return endpoint.protocol !== 'ollama' || !ollamaDisabled();
}

function imageUserMessage(
  protocol: ChatProtocol,
  prompt: string,
  image: ChatImage,
): Record<string, unknown> {
  if (protocol === 'anthropic') {
    return {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
        },
        { type: 'text', text: prompt },
      ],
    };
  }
  if (protocol === 'ollama') return { role: 'user', content: prompt, images: [image.base64] };
  return {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      {
        type: 'image_url',
        image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
      },
    ],
  };
}

function chatTimedOut(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'TimeoutError';
}

/**
 * Normalizes one provider response into text plus tool calls. OpenAI's message is
 * `choices[0].message`. Claude's is a `content` array of text and `tool_use` blocks.
 * Ollama's is the top-level `message`.
 */
function readAssistantTurn(protocol: ChatProtocol, payload: object): AssistantTurn | null {
  if (protocol === 'anthropic') return readAnthropicTurn(payload);
  const message = protocol === 'openai' ? openAiMessage(payload) : ollamaMessage(payload);
  if (!message) return null;
  const text = messageText(message.content);
  return { wire: message, text: text ?? '', calls: readToolCalls(message) };
}

/** The assistant message object Ollama returned, or null when the body has none. */
function ollamaMessage(payload: object): Record<string, unknown> | null {
  if (!('message' in payload)) return null;
  const message = payload.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  return message as Record<string, unknown>;
}

/** The first choice message from an OpenAI chat-completions response. */
function openAiMessage(payload: object): Record<string, unknown> | null {
  if (!('choices' in payload) || !Array.isArray(payload.choices)) return null;
  const choice = payload.choices[0];
  if (!choice || typeof choice !== 'object' || !('message' in choice)) return null;
  const message = choice.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  return message as Record<string, unknown>;
}

/**
 * Claude returns a list of blocks. Text is joined for the scan JSON. Each `tool_use`
 * block becomes a call. The original blocks are sent back as the assistant turn.
 */
function readAnthropicTurn(payload: object): AssistantTurn | null {
  if (!('content' in payload) || !Array.isArray(payload.content)) return null;
  const texts: string[] = [];
  const calls: ParsedToolCall[] = [];
  for (const block of payload.content) {
    if (!block || typeof block !== 'object') continue;
    if (
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      typeof block.text === 'string'
    ) {
      texts.push(block.text);
    }
    if ('type' in block && block.type !== 'tool_use') continue;
    if (!('name' in block) || typeof block.name !== 'string' || !block.name.trim()) continue;
    const id =
      'id' in block && typeof block.id === 'string' && block.id.trim()
        ? block.id.trim()
        : `toolu-${calls.length}`;
    const input = 'input' in block ? block.input : undefined;
    calls.push({ id, name: block.name.trim(), arguments: readToolArguments(input) });
  }
  if (texts.length === 0 && calls.length === 0) return null;
  return { wire: { role: 'assistant', content: payload.content }, text: texts.join('\n'), calls };
}

/**
 * Text from a message. A string is kept. OpenAI's `null` content means there is no text.
 * A list of parts keeps each `text` field. Anything else is no text.
 */
function messageText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string')
      continue;
    parts.push(part.text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Appends the assistant turn and the tool results in that provider's shape.
 * Claude wants one user message of `tool_result` blocks. OpenAI wants `tool_call_id`.
 * Ollama wants `tool_name`.
 */
function appendToolResults(
  protocol: ChatProtocol,
  messages: Record<string, unknown>[],
  wire: Record<string, unknown>,
  calls: ParsedToolCall[],
  results: ToolResult[],
): void {
  messages.push(wire);
  if (protocol === 'anthropic') {
    messages.push({ role: 'user', content: anthropicToolResults(wire, calls, results) });
    return;
  }
  for (let index = 0; index < calls.length; index++) {
    const call = calls[index]!;
    const content = JSON.stringify(results[index] ?? { error: 'Lookup failed.' });
    messages.push(
      protocol === 'openai'
        ? { role: 'tool', tool_call_id: call.id, content }
        : { role: 'tool', tool_name: call.name, content },
    );
  }
}

/**
 * One `tool_result` per `tool_use` in the assistant turn, in that same order.
 * A call the runner did not execute still gets an error result. Claude returns
 * 400 when any id is missing.
 */
function anthropicToolResults(
  wire: Record<string, unknown>,
  calls: ParsedToolCall[],
  results: ToolResult[],
): object[] {
  const byId = new Map<string, ToolResult>();
  calls.forEach((call, index) => {
    byId.set(call.id, results[index] ?? { error: 'Lookup failed.' });
  });
  const content = Array.isArray(wire.content) ? wire.content : [];
  const blocks: object[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || !('type' in block) || block.type !== 'tool_use')
      continue;
    const id = 'id' in block && typeof block.id === 'string' ? block.id : '';
    if (!id) continue;
    const ran = byId.has(id);
    blocks.push({
      type: 'tool_result',
      tool_use_id: id,
      content: JSON.stringify(ran ? byId.get(id) : { error: 'Tool call was not run.' }),
      ...(ran ? {} : { is_error: true }),
    });
  }
  if (blocks.length > 0) return blocks;
  return calls.map((call, index) => ({
    type: 'tool_result',
    tool_use_id: call.id,
    content: JSON.stringify(results[index] ?? { error: 'Lookup failed.' }),
  }));
}

/**
 * Tool calls on an assistant message. Ollama and OpenAI put them on `tool_calls`
 * with `function.name` and `function.arguments`. Arguments may be an object or
 * a JSON string. A call without a name is ignored. A missing id is filled in so
 * the OpenAI follow-up still has a `tool_call_id`.
 */
function readToolCalls(message: Record<string, unknown> | null): ParsedToolCall[] {
  if (!message || !Array.isArray(message.tool_calls)) return [];
  const calls: ParsedToolCall[] = [];
  for (const call of message.tool_calls) {
    if (!call || typeof call !== 'object') continue;
    const fn =
      'function' in call && call.function && typeof call.function === 'object'
        ? call.function
        : call;
    if (!fn || typeof fn !== 'object' || !('name' in fn) || typeof fn.name !== 'string') continue;
    const name = fn.name.trim();
    if (!name) continue;
    const id =
      'id' in call && typeof call.id === 'string' && call.id.trim()
        ? call.id.trim()
        : `call-${calls.length}`;
    const args = 'arguments' in fn ? fn.arguments : undefined;
    calls.push({ id, name, arguments: readToolArguments(args) });
  }
  return calls;
}

/** Tool arguments as an object. A JSON string is parsed. Anything else is empty. */
function readToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

/**
 * Runs one tool the model named. Unknown names and bad coordinates come back as
 * `{ error }` so the model can correct itself. A lookup failure is the same shape
 * and does not abort the rest of the scan.
 */
/** Opens the chosen source, ticket, info, or Facebook page. */
async function fetchEventPage(context: LookupContext): Promise<ToolResult> {
  const url = lookupPageUrl(context.event.pageLinks, context.event.sourceUrl);
  if (!url || !context.fetch) return { error: 'No page to fetch.' };
  const loaded = await loadPublicHtml(url, {
    fetch: context.fetch,
    ...(context.resolveHost ? { resolveHost: context.resolveHost } : {}),
  });
  if ('error' in loaded) return loaded;
  return pageFromHtml(loaded.html, loaded.url);
}

async function executeToolCall(call: ParsedToolCall, context: LookupContext): Promise<ToolResult> {
  try {
    if (call.name === 'getAvailableTags') return lookupAvailableTags(context.catalog);
    if (call.name === 'getNearbyEvents') return lookupNearbyEvents(context);
    if (call.name === 'getNearbyPublishers') return lookupNearbyPublishers(context);
    if (call.name === 'getPublishersByName') return lookupPublishersByName(call.arguments, context);
    if (call.name === 'getEventsByName') return lookupEventsByName(call.arguments, context);
    if (call.name === 'getVenuesByName') return lookupVenuesByName(call.arguments, context);
    if (call.name === 'getPossiblePublishers') return lookupPossiblePublishers(context);
    if (call.name === 'getVenueFromName') return lookupVenueFromName(call.arguments, context);
    if (call.name === 'geocodePlace') return lookupGeocodePlace(call.arguments, context);
    if (call.name === 'fetchEventPage') return fetchEventPage(context);
    return { error: `Unknown tool ${call.name}.` };
  } catch {
    return { error: 'Lookup failed.' };
  }
}

/**
 * Tags loaded for this batch. The id field matches the `possibleTags` JSON the
 * model must return, so it can copy an id from this list.
 */
function lookupAvailableTags(catalog: TagChoice[]): ToolResult {
  return { tags: catalog.map((tag) => ({ id: tag.externalId, name: tag.name })) };
}

/** The event's own point. Nearby tools never take coordinates from the model. */
function eventPoint(context: LookupContext): { lat: number; lng: number } | { error: string } {
  if (!context.event.location) return { error: 'This event has no point.' };
  return context.event.location;
}

/** A place id from geocodePlace. A number and a numeric string are the same id. */
function placeUseId(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

const VENUE_NAME_CALLS = 2;

/** A venue by exact name, then one wildcard name, or that venue's point. */
async function lookupVenueFromName(
  args: Record<string, unknown>,
  context: LookupContext,
): Promise<ToolResult> {
  const points = context.venuePoints;
  if (!points) return { error: 'This event already has a point.' };
  const use = typeof args.use === 'string' ? args.use.trim() : '';
  if (use) {
    const point = points.get(use);
    if (!point) return { error: 'That venue was not found.' };
    context.event.location = point;
    context.chosenVenueId = use;
    if (context.placeSearch) context.placeSearch.chosen = point;
    return { using: true, placeId: use, venueId: use };
  }
  const name = typeof args.name === 'string' ? args.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return { error: 'name is required.' };
  if (name.length > 120) return { error: 'name is too long.' };
  if (!/[0-9a-zåäö]/i.test(name)) return { error: 'name needs a letter or number.' };
  const calls = context.venueLookups ?? 0;
  if (calls >= VENUE_NAME_CALLS) return { error: 'A venue can be looked up twice.' };
  const wildcard = /[*?]/.test(name);
  if (wildcard && calls === 0) return { error: 'Look up the exact name first.' };
  context.venueLookups = calls + 1;
  const found = wildcard
    ? await context.store.venuesByPattern(name)
    : await context.store.venuesByExactName(name.toLocaleLowerCase('sv'));
  const venues = found.map((venue) => {
    points.set(venue.id, venue.location);
    return {
      id: venue.id,
      name: venue.name,
      city: venue.city,
      address: venue.address ?? null,
    };
  });
  return { venues };
}

/** A name the model chose, or a place id from an earlier geocodePlace result. */
async function lookupGeocodePlace(
  args: Record<string, unknown>,
  context: LookupContext,
): Promise<ToolResult> {
  const search = context.placeSearch;
  if (!search) return { error: 'This event already has a point.' };
  const use = placeUseId(args.use);
  if (use) {
    const place = search.byId.get(use);
    if (!place) return { error: 'That place was not found.' };
    context.event.location = { lat: place.lat, lng: place.lng };
    search.chosen = context.event.location;
    return { using: true, placeId: use };
  }
  const name = typeof args.name === 'string' ? args.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return { error: 'name is required.' };
  if (name.length > 120) return { error: 'name is too long.' };
  if (!/[0-9a-zåäö]/i.test(name)) return { error: 'name needs a letter or number.' };
  if (search.calls >= GEOCODE_CALLS) return { error: 'A place can be looked up twice.' };
  search.calls += 1;
  const found = await placesForName(name, context.fetch ?? fetch);
  const places = found.map((place) => {
    const id = String(search.nextId);
    search.nextId += 1;
    search.byId.set(id, place);
    return { id, label: place.label };
  });
  return { places };
}

/**
 * The time window the model cannot pass: one day before the scanned start
 * through 60 days after. An unreadable start makes the window empty.
 */
function nearbyWindow(startsAt: string): NearbyWindow {
  const start = new Date(startsAt).getTime();
  if (!Number.isFinite(start)) return { from: new Date(0), to: new Date(0) };
  return {
    from: new Date(start - NEARBY_DAYS_BEFORE * DAY_MS),
    to: new Date(start + NEARBY_DAYS_AFTER * DAY_MS),
  };
}

/**
 * Nearby events around the event being scanned. The scanned event is left out.
 * The model does not pass a point.
 */
async function lookupNearbyEvents(context: LookupContext): Promise<ToolResult> {
  const point = eventPoint(context);
  if ('error' in point) return point;
  const window = nearbyWindow(context.event.startsAt);
  const events = await context.store.nearbyEvents(point, window, context.event.eventId);
  return { events };
}

/** Possible publisher candidates based on the event organizer keys and the event location. */
async function lookupPossiblePublishers(context: LookupContext): Promise<ToolResult> {
  const event = context.event;
  const localSlugs = [...new Set([event.source.slug, ...LOCAL_ORGANIZER_SLUGS])];
  const publishers = await context.store.listPublisherCandidates(
    event.source.id,
    event.organizer.keys,
    {
      ...(event.location ? { location: event.location } : {}),
      localSlugs,
    },
  );
  //).filter((publisher) => publisher.distanceMeters <= 500);
  const possiblePublishers = publishers.map((publisher) => ({
    publisherId: publisher.publisherId,
    sourceId: publisher.sourceId,
    key: publisher.key,
    status: publisher.status,
    createdAt: publisher.createdAt,
    distanceMeters: publisher.distanceMeters,
    isTemporary: publisher.isTemporary,
    organizerKeys: publisher.organizerKeys,
    publisherName: publisher.publisherName,
  }));
  return { possiblePublishers };
}

/**
 * Publishers with an event near the point, in the same window as nearby events.
 * Each publisher is returned once, from its closest event, capped at 20.
 */
async function lookupNearbyPublishers(context: LookupContext): Promise<ToolResult> {
  const point = eventPoint(context);
  if ('error' in point) return point;
  const window = nearbyWindow(context.event.startsAt);
  const publishers = await context.store.nearbyPublishers(point, window, context.event.eventId);
  return { publishers };
}

/**
 * Publishers whose name matches `*` and `?`, and that have an event within 50 km
 * of the event being scanned. A pattern with no letter or number is an error.
 */
async function lookupPublishersByName(
  args: Record<string, unknown>,
  context: LookupContext,
): Promise<ToolResult> {
  const point = eventPoint(context);
  if ('error' in point) return point;
  const name = typeof args.name === 'string' ? args.name : '';
  const matcher = publisherNameMatcher(name);
  if ('error' in matcher) return matcher;
  const publishers = await context.store.publishersByName(point, name, context.event.eventId);
  return { publishers };
}

/**
 * Events whose title matches the model's wildcards and whose showing starts in
 * the model's date range, within 50 km. A pattern with no letter or number,
 * or a range longer than a year, is an error.
 */
async function lookupEventsByName(
  args: Record<string, unknown>,
  context: LookupContext,
): Promise<ToolResult> {
  const point = eventPoint(context);
  if ('error' in point) return point;
  const names = readEventNamePatterns(args.names);
  if ('error' in names) return names;
  const window = readEventNameRange(args.from, args.to);
  if ('error' in window) return window;
  const events = await context.store.eventsByName(point, names, window, context.event.eventId);
  return { events };
}

/** Venues whose name matches `*` and `?`, within 50 km of the event point. */
async function lookupVenuesByName(
  args: Record<string, unknown>,
  context: LookupContext,
): Promise<ToolResult> {
  const point = eventPoint(context);
  if ('error' in point) return point;
  const name = typeof args.name === 'string' ? args.name : '';
  const matcher = publisherNameMatcher(name);
  if ('error' in matcher) return matcher;
  const venues = await context.store.venuesByName(point, name);
  return { venues };
}

/** Wildcard title patterns. A string is accepted as one pattern. */
function readEventNamePatterns(raw: unknown): string[] | { error: string } {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const names = values.flatMap((item) =>
    typeof item === 'string' && item.trim() ? [item.trim()] : [],
  );
  if (names.length === 0) return { error: 'names is required.' };
  if (names.length > EVENT_NAME_PATTERN_LIMIT) {
    return { error: `names accepts at most ${EVENT_NAME_PATTERN_LIMIT} patterns.` };
  }
  for (const name of names) {
    const matcher = publisherNameMatcher(name);
    if ('error' in matcher) return matcher;
  }
  return names;
}

/** Inclusive start window. `from` must be before `to`, and the span at most a year. */
function readEventNameRange(
  fromRaw: unknown,
  toRaw: unknown,
): { from: Date; to: Date } | { error: string } {
  const from = typeof fromRaw === 'string' ? new Date(fromRaw) : new Date(NaN);
  const to = typeof toRaw === 'string' ? new Date(toRaw) : new Date(NaN);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return { error: 'from and to must be ISO-8601 datetimes.' };
  }
  if (from.getTime() > to.getTime()) return { error: 'from must be before to.' };
  if (to.getTime() - from.getTime() > EVENT_NAME_RANGE_MS) {
    return { error: 'date range must be at most one year.' };
  }
  return { from, to };
}

/**
 * Pulls the scan JSON out of the model text. A fenced block is preferred. Otherwise
 * the last object that has scan fields is used, so tag examples earlier in the
 * reply are ignored. Prose or a broken object is a failed scan. A parsed object
 * with no verdict stays `unknown`.
 */
function scanRangeOf(record: Record<string, unknown>): {
  startsAt: string | null;
  endsAt: string | null;
} {
  const range = readScanRange(record);
  return range ?? { startsAt: null, endsAt: null };
}

export function parseScanJson(content: string): LLMScanResult | null {
  const record = extractScanRecord(content);
  if (!record) return null;
  return {
    contentVerdict: readContentVerdict(record.contentVerdict, 'unknown'),
    possibleTags: tagScores(record.possibleTags),
    possiblePublishers: possiblePublishers(record.possiblePublishers),
    possibleDuplicates: possibleDuplicates(record.possibleDuplicates),
    summary: typeof record.summary === 'string' ? record.summary : '',
    language: typeof record.language === 'string' ? record.language : '',
    instructions: readScanInstructions(record.instructions),
    possibleVenueNames: possibleVenueNames(record.possibleVenueNames),
    possibleVenues: possibleVenues(record.possibleVenues),
    possibleOccasions: readScanOccasions(record),
    ...scanRangeOf(record),
    ...addressFromModel(record.address),
  };
}

/**
 * Reads the stored scan payload from `events.llm_output`.
 * Accepts provider payloads (OpenAI, Ollama, Anthropic) and a bare scan object.
 */
export function parseStoredScanOutput(output: unknown): (LLMScanResult & LLMOutput) | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const direct = isScanRecord(record) ? normalizeStoredScanRecord(record) : null;
  if (direct) return direct;
  const assistant = assistantContentText(record);
  if (!assistant) return null;
  const parsed = parseScanJson(assistant);
  if (!parsed) return null;
  return { ...parsed, output: record };
}

function normalizeStoredScanRecord(record: Record<string, unknown>): LLMScanResult & LLMOutput {
  const normalized = parseScanJson(JSON.stringify(record));
  if (!normalized) {
    return {
      contentVerdict: 'unknown',
      possibleTags: [],
      possiblePublishers: [],
      possibleDuplicates: [],
      summary: '',
      language: '',
      instructions: [],
      possibleVenueNames: [],
      possibleVenues: [],
      possibleOccasions: [],
      startsAt: null,
      endsAt: null,
      output: record,
    };
  }
  return { ...normalized, output: record };
}

function assistantContentText(record: Record<string, unknown>): string | null {
  const message = openAiMessage(record) ?? ollamaMessage(record) ?? anthropicMessage(record);
  if (!message) return null;
  return messageText(message.content);
}

function anthropicMessage(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(payload.content)) return null;
  const parts: { text: string }[] = [];
  for (const block of payload.content) {
    if (!block || typeof block !== 'object') continue;
    const type = 'type' in block ? block.type : undefined;
    const text = 'text' in block ? block.text : undefined;
    if (type === 'text' && typeof text === 'string') parts.push({ text });
  }
  if (parts.length === 0) return null;
  return { content: parts };
}

/** Street, postcode, and city from the scan JSON. A coordinate in that object is dropped. */
function addressFromModel(
  value: unknown,
): { address: EventAddressRecord & { rank?: number } } | Record<string, never> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const address = eventAddress({
    address: typeof record.address === 'string' ? record.address : undefined,
    zipCode: typeof record.zipCode === 'string' ? record.zipCode : undefined,
    city: typeof record.city === 'string' ? record.city : undefined,
  });
  if (!address) return {};
  const rank =
    typeof record.rank === 'number' && Number.isFinite(record.rank) ? record.rank : undefined;
  return rank === undefined ? { address } : { address: { ...address, rank } };
}

/** Scan object from a markdown fence, or from the reply when the fence is absent. */
function extractScanRecord(content: string): Record<string, unknown> | null {
  const fences = fencedBlocks(content);
  for (let index = fences.length - 1; index >= 0; index -= 1) {
    const block = fences[index];
    if (!block) continue;
    const fenced = lastScanRecord(jsonObjects(block));
    if (fenced) return fenced;
  }
  return lastScanRecord(jsonObjects(content));
}

/** Last object that carries the scan fields. Tag snippets earlier in the text are skipped. */
function lastScanRecord(
  objects: readonly Record<string, unknown>[],
): Record<string, unknown> | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const record = objects[index];
    if (record && isScanRecord(record)) return record;
  }
  return null;
}

function isScanRecord(record: Record<string, unknown>): boolean {
  return (
    'contentVerdict' in record ||
    'possibleTags' in record ||
    'possiblePublishers' in record ||
    'possibleDuplicates' in record
  );
}

/** Bodies of ``` or ```json fences, in the order they appear. */
function fencedBlocks(content: string): string[] {
  const blocks: string[] = [];
  for (const match of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

/**
 * Top-level JSON objects in `content`. A value that parses is consumed, so a
 * scan object is not split into the objects nested inside it. Braces inside
 * strings do not end an object. Raw newlines inside a string are escaped
 * before parsing; models emit those and strict JSON rejects them.
 */
function jsonObjects(content: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  let index = 0;
  while (index < content.length) {
    const start = content.indexOf('{', index);
    if (start < 0) break;
    const end = matchingBrace(content, start);
    if (end < 0) {
      index = start + 1;
      continue;
    }
    const parsed = parseJsonObject(content.slice(start, end + 1));
    if (parsed) {
      objects.push(parsed);
      index = end + 1;
      continue;
    }
    index = start + 1;
  }
  return objects;
}

/**
 * Parses one JSON object. A model often puts a raw newline inside a string.
 * That is not JSON, so those controls are escaped and the text is parsed again.
 * A span that still does not parse, or that parses as something other than an
 * object, is skipped.
 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const parsed = parseJsonValue(text) ?? parseJsonValue(escapeControlsInJsonStrings(text));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Replaces raw control characters that sit inside JSON strings. Newlines,
 * returns, and tabs become the usual escapes. Other controls become `\u00XX`.
 * Characters outside strings are left as they are, so pretty-printed JSON
 * stays valid.
 */
function escapeControlsInJsonStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    const code = text.charCodeAt(index);
    if (inString) {
      if (escaped) {
        escaped = false;
        out += char;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        out += char;
        continue;
      }
      if (char === '"') {
        inString = false;
        out += char;
        continue;
      }
      if (code < 32) {
        if (char === '\n') out += '\\n';
        else if (char === '\r') out += '\\r';
        else if (char === '\t') out += '\\t';
        else out += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
      out += char;
      continue;
    }
    if (char === '"') inString = true;
    out += char;
  }
  return out;
}

/** Index of the `}` that closes the `{` at `open`. Returns -1 when the object is cut off. */
function matchingBrace(content: string, open: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Keeps only the three verdicts the scan stores. Anything else uses `fallback`. */
function readContentVerdict(
  value: unknown,
  fallback: LLMScanResult['contentVerdict'],
): LLMScanResult['contentVerdict'] {
  if (value === 'spam' || value === 'harmful' || value === 'safe' || value === 'unknown')
    return value;
  return fallback;
}

/** Tag scores the catalog matcher understands. Rows that are not objects are dropped. */
function tagScores(value: unknown): LLMScanResult['possibleTags'] {
  if (!Array.isArray(value)) return [];
  const scores: LLMScanResult['possibleTags'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const id = 'id' in item ? item.id : undefined;
    const score = 'score' in item ? item.score : undefined;
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof score !== 'number') continue;
    scores.push({ id: String(id), score });
  }
  return scores;
}

function possibleVenueNames(value: unknown): LLMScanResult['possibleVenueNames'] {
  if (!Array.isArray(value)) return [];
  const names: LLMScanResult['possibleVenueNames'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const name = 'name' in item ? item.name : undefined;
    const rank = 'rank' in item ? item.rank : undefined;
    if (typeof name !== 'string' || typeof rank !== 'number') continue;
    names.push({ name, rank });
  }
  return names;
}

function possibleVenues(value: unknown): LLMScanResult['possibleVenues'] {
  if (!Array.isArray(value)) return [];
  const venues: LLMScanResult['possibleVenues'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const venueId = 'venueId' in item ? item.venueId : undefined;
    const rank = 'rank' in item ? item.rank : undefined;
    if ((typeof venueId !== 'string' && typeof venueId !== 'number') || typeof rank !== 'number') {
      continue;
    }
    venues.push({ venueId: String(venueId), rank });
  }
  return venues;
}

function possiblePublishers(value: unknown): LLMScanResult['possiblePublishers'] {
  if (!Array.isArray(value)) return [];
  const publishers: LLMScanResult['possiblePublishers'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const publisherId = 'publisherId' in item ? item.publisherId : undefined;
    const rank = 'rank' in item ? item.rank : undefined;
    if (
      (typeof publisherId !== 'string' && typeof publisherId !== 'number') ||
      typeof rank !== 'number'
    )
      continue;
    publishers.push({ publisherId: String(publisherId), rank });
  }
  return publishers;
}

function possibleDuplicates(value: unknown): LLMScanResult['possibleDuplicates'] {
  if (!Array.isArray(value)) return [];
  const duplicates: LLMScanResult['possibleDuplicates'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const eventId = 'eventId' in item ? item.eventId : undefined;
    const rank = 'rank' in item ? item.rank : undefined;
    const occasionRank = 'occasionRank' in item ? item.occasionRank : undefined;
    if ((typeof eventId !== 'string' && typeof eventId !== 'number') || typeof rank !== 'number')
      continue;
    duplicates.push({ eventId: String(eventId), rank, occasionRank });
  }
  return duplicates;
}

/**
 * Cache key for one model answer. Place and start are included because the tools
 * depend on them. The event id is not, so two copies of the same listing share a call.
 */
function scanCacheKey(event: TagMatchInput & Pick<ScanInput, 'startsAt' | 'location'>): string {
  const point = event.location ? `${event.location.lat},${event.location.lng}` : '';
  return [event.title, event.description ?? '', event.venue ?? '', event.startsAt, point].join(
    '\n',
  );
}
