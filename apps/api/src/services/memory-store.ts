import type { Event, Tag } from '@local-events/contracts';
import { SEED_TAGS, type PushMessageRow } from '@local-events/db';

export type MemoryUser = {
  id: string;
  createdAt: Date;
  displayName: string | null;
  isPublic: boolean;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: Date | null;
  profileChosenAt: Date | null;
  timezone: string;
  quietHoursStartMin: number;
  quietHoursEndMin: number;
  quietHoursEnabled: boolean;
  travelDistanceM: number;
  bannedAt: Date | null;
  banReason: string | null;
};
export type MemoryDevice = {
  id: string;
  userId: string;
  credentialHash: string;
  platform: string;
  locale: string;
  expoPushToken: string | null;
  lastSeenAt: Date;
  revokedAt: Date | null;
};
export type MemorySession = {
  id: string;
  subjectType: 'user' | 'publisher_account' | 'admin';
  subjectId: string;
  tokenHash: string;
  client: string;
  expiresAt: Date;
  revokedAt: Date | null;
};
export type MemoryPublisherAccount = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
};
export type MemoryPublisher = {
  id: string;
  type: 'org' | 'person';
  name: string;
  slug: string;
  verified: boolean;
  origin: 'native' | 'imported';
  createdAt: Date;
};
export type MemoryMember = {
  publisherId: string;
  publisherAccountId: string;
  role: 'owner' | 'editor';
  createdAt: Date;
};
export type MemoryPublisherInvite = {
  id: string;
  publisherId: string;
  email: string;
  role: 'owner' | 'editor';
  tokenHash: string;
  invitedByAccountId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
};
export type MemoryUserInterest = {
  userId: string;
  tagId: string;
  createdAt: Date;
};
export type MemoryUserArea = {
  id: string;
  userId: string;
  name: string;
  kind: 'manual' | 'region';
  origin: 'manual' | 'suggested';
  regionId: string | null;
  center: { lat: number; lng: number } | null;
  radiusM: number | null;
  polygon: { lat: number; lng: number }[] | null;
  notify: boolean;
  active: boolean;
  tagIds: string[];
  createdAt: Date;
};
export type MemoryRegion = {
  id: string;
  name: string;
  kind: 'municipality' | 'county';
  code: string;
  /** Axis-aligned bbox for in-memory point-in-region (fixture). */
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};
export type MemoryToken = {
  id: string;
  purpose: string;
  subjectId: string;
  /** For device_link_code: device waiting to be reassigned. */
  deviceId?: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export type MemoryAttendeeLink = {
  id: string;
  url: string;
  label: string | null;
  position: number;
};

export type MemoryEventRow = Event & {
  startsAtDate: Date;
  endsAtDate: Date;
  attendeeText?: string | null;
  attendeeLinks?: MemoryAttendeeLink[];
};

/** Shared in-memory tables for auth + events + admin tests. */
export type MemorySubscription = {
  userId: string;
  targetType: 'publisher' | 'event';
  targetId: string;
  createdAt: Date;
};

export type MemoryNotification = {
  id: string;
  userId: string;
  eventId: string;
  pushMessageId?: string | null;
  reason: 'nearby' | 'publisher' | 'event';
  pushState: 'pending' | 'sent' | 'aggregated';
  sentAt: Date;
  pushedAt: Date | null;
  readAt: Date | null;
};

export type MemoryDigitalCode = {
  eventId: string;
  secret: string;
  revealedAt: Date | null;
  rotationS: number;
  createdAt: Date;
};

export type MemoryCheckIn = {
  id: string;
  userId: string;
  eventId: string;
  method: 'geo' | 'code';
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  createdAt: Date;
};

export type MemoryEventContent = {
  id: string;
  eventId: string;
  kind: 'map' | 'schedule' | 'info' | 'file';
  title: string;
  body: string | null;
  s3Key: string | null;
  visibility: 'public' | 'attendees';
  createdAt: Date;
};

export type MemorySavedEvent = {
  userId: string;
  eventId: string;
  createdAt: Date;
};

export type MemoryEventList = {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
};

export type MemoryEventListItem = {
  listId: string;
  eventId: string;
  createdAt: Date;
};

export type MemoryEventReport = {
  id: string;
  userId: string;
  eventId: string;
  createdAt: Date;
};

export type MemoryRating = {
  id: string;
  userId: string;
  eventId: string;
  score: number;
  comment: string | null;
  createdAt: Date;
  hiddenAt: Date | null;
};

export type MemoryComingEvent = {
  userId: string;
  eventId: string;
  createdAt: Date;
};

export type MemoryStore = {
  users: Map<string, MemoryUser>;
  devices: Map<string, MemoryDevice>;
  sessions: Map<string, MemorySession>;
  accounts: Map<string, MemoryPublisherAccount>;
  publishers: Map<string, MemoryPublisher>;
  members: MemoryMember[];
  invites: MemoryPublisherInvite[];
  userInterests: MemoryUserInterest[];
  userAreas: Map<string, MemoryUserArea>;
  regions: Map<string, MemoryRegion>;
  tokens: Map<string, MemoryToken>;
  tags: Map<string, Tag>;
  events: Map<string, MemoryEventRow>;
  savedEvents: MemorySavedEvent[];
  comingEvents: MemoryComingEvent[];
  eventLists: MemoryEventList[];
  eventListItems: MemoryEventListItem[];
  subscriptions: MemorySubscription[];
  notifications: Map<string, MemoryNotification>;
  pushMessages?: Map<string, PushMessageRow>;
  digitalCodes: Map<string, MemoryDigitalCode>;
  checkIns: MemoryCheckIn[];
  eventContent: MemoryEventContent[];
  eventReports: MemoryEventReport[];
  ratings: MemoryRating[];
  /** EAV stats: `${sourceType}:${sourceId}:${key}` → value. */
  stats: Map<string, { value: number; createdAt: Date; updatedAt: Date }>;
};

/** Lifetime engagement stored the same way as the stats table (`event:{id}:numSaved`). */
export function memoryEventEngagement(
  store: Pick<MemoryStore, 'stats'>,
  eventId: string,
): { numSaved: number; numComing: number } {
  return {
    numSaved: store.stats.get(`event:${eventId}:numSaved`)?.value ?? 0,
    numComing: store.stats.get(`event:${eventId}:numComing`)?.value ?? 0,
  };
}

/** Fixed UUIDs matching packages/db seed migration for regions. */
export const SEED_REGION_SODERHAMN_ID = '22222222-2222-4222-8222-222222222201';
export const SEED_REGION_GAVLEBORG_ID = '22222222-2222-4222-8222-222222222202';

export function createMemoryStore(): MemoryStore {
  const tags = new Map<string, Tag>();
  for (const tag of SEED_TAGS) tags.set(tag.id, { id: tag.id, slug: tag.slug, name: tag.name });
  const regions = new Map<string, MemoryRegion>();
  regions.set(SEED_REGION_SODERHAMN_ID, {
    id: SEED_REGION_SODERHAMN_ID,
    name: 'Söderhamn',
    kind: 'municipality',
    code: '2180',
    bbox: { minLat: 61.15, maxLat: 61.45, minLng: 16.85, maxLng: 17.35 },
  });
  regions.set(SEED_REGION_GAVLEBORG_ID, {
    id: SEED_REGION_GAVLEBORG_ID,
    name: 'Gävleborg',
    kind: 'county',
    code: '21',
    bbox: { minLat: 60.5, maxLat: 62.5, minLng: 15.5, maxLng: 18.0 },
  });
  return {
    users: new Map(),
    devices: new Map(),
    sessions: new Map(),
    accounts: new Map(),
    publishers: new Map(),
    members: [],
    invites: [],
    userInterests: [],
    userAreas: new Map(),
    regions,
    tokens: new Map(),
    tags,
    events: new Map(),
    savedEvents: [],
    comingEvents: [],
    eventLists: [],
    eventListItems: [],
    subscriptions: [],
    notifications: new Map(),
    pushMessages: new Map(),
    digitalCodes: new Map(),
    checkIns: [],
    eventContent: [],
    eventReports: [],
    ratings: [],
    stats: new Map(),
  };
}
