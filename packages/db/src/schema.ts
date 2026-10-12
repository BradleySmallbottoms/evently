/**
 * Schema covering identity, publishers, events, preferences and ingestion.
 * The full model is in docs/project-description.md (Data model); add the remaining tables
 * (ratings, stats, ...) as each phase needs them.
 * Spatial indexes (GiST) are declared with `.using('gist', ...)`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyMultiPolygon, geographyPoint, geographyPolygon } from './postgis';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const eventMode = pgEnum('event_mode', ['physical', 'digital']);
export const eventStatus = pgEnum('event_status', [
  'draft',
  'awaiting_verification',
  'in_review',
  'published',
  'cancelled',
  'ended',
]);
export const origin = pgEnum('origin', ['native', 'imported']);
export const publisherType = pgEnum('publisher_type', ['org', 'person']);
export const memberRole = pgEnum('member_role', ['owner', 'editor']);
export const sessionSubject = pgEnum('session_subject', ['user', 'publisher_account', 'admin']);
export const sourceKind = pgEnum('source_kind', ['api', 'feed', 'scraper']);
export const sourceTrust = pgEnum('source_trust', ['auto_publish', 'review']);
export const userAreaKind = pgEnum('user_area_kind', ['manual', 'region']);
export const userAreaOrigin = pgEnum('user_area_origin', ['manual', 'suggested']);
export const regionKind = pgEnum('region_kind', ['municipality', 'county']);
/** Why a push was sent — `nearby` first; publisher/event follows come later. */
export const notificationReason = pgEnum('notification_reason', [
  'nearby',
  'publisher',
  'event',
]);
/**
 * Silent Expo delivery state for an inbox row.
 * `aggregated` is legacy (server quiet-hours digest); new writes use pending → sent.
 */
export const notificationPushState = pgEnum('notification_push_state', [
  'pending',
  'sent',
  'aggregated',
]);
export const subscriptionTarget = pgEnum('subscription_target', ['publisher', 'event']);
export const checkInMethod = pgEnum('check_in_method', ['geo', 'code']);
export const eventLinkAudience = pgEnum('event_link_audience', ['public', 'attendees']);
export const eventContentKind = pgEnum('event_content_kind', ['map', 'schedule', 'info', 'file']);
export const eventContentVisibility = pgEnum('event_content_visibility', ['public', 'attendees']);
/** Outbound action on an event: buy tickets, register, or read more. */
export const eventLinkType = pgEnum('event_link_type', ['tickets', 'registration', 'info']);

// ---------- identity ----------
export const users = pgTable('users', {
  id: id(),
  displayName: text('display_name'),
  isPublic: boolean('is_public').notNull().default(false),
  recoveryEmail: text('recovery_email'),
  recoveryEmailVerifiedAt: timestamp('recovery_email_verified_at', { withTimezone: true }),
  /**
   * Set when the user answers the first-check-in profile prompt (named or anonymous).
   * Null means the app should still offer the prompt after check-in.
   */
  profileChosenAt: timestamp('profile_chosen_at', { withTimezone: true }),
  /** IANA timezone for quiet-hours evaluation (launch default: Sweden). */
  timezone: text('timezone').notNull().default('Europe/Stockholm'),
  /** Minutes from local midnight; window wraps midnight when start ≥ end. */
  quietHoursStartMin: integer('quiet_hours_start_min').notNull().default(22 * 60),
  quietHoursEndMin: integer('quiet_hours_end_min').notNull().default(8 * 60),
  quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(true),
  /** Set by admin moderation; banned users cannot create sessions or check in. */
  bannedAt: timestamp('banned_at', { withTimezone: true }),
  banReason: text('ban_reason'),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialHash: text('credential_hash').notNull(),
    expoPushToken: text('expo_push_token'),
    platform: text('platform').notNull(),
    locale: text('locale').notNull().default('sv'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('devices_credential_hash_idx').on(t.credentialHash)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    subjectType: sessionSubject('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    client: text('client').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_hash_idx').on(t.tokenHash)],
);

export const webLoginCodes = pgTable('web_login_codes', {
  id: id(),
  codeHash: text('code_hash').notNull(),
  purpose: text('purpose').notNull().default('web_login'), // or 'device_link'
  browserLabel: text('browser_label'),
  status: text('status').notNull().default('pending'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Set for device_link: which device should be reassigned on confirm. */
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const publisherAccounts = pgTable(
  'publisher_accounts',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('publisher_accounts_email_idx').on(sql`lower(${t.email})`)],
);

/** Single-use tokens for publisher email verification (and later recovery emails). */
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: id(),
    purpose: text('purpose').notNull(), // e.g. 'publisher_email'
    subjectId: uuid('subject_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('email_verification_tokens_hash_idx').on(t.tokenHash)],
);

export const adminUsers = pgTable('admin_users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecret: text('totp_secret'),
  role: text('role').notNull().default('admin'),
  createdAt: createdAt(),
});

// ---------- publishers ----------
export const publishers = pgTable(
  'publishers',
  {
    id: id(),
    type: publisherType('type').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    verified: boolean('verified').notNull().default(false),
    origin: origin('origin').notNull().default('native'),
    isTemporary: boolean('is_temporary').notNull().default(false),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('publishers_slug_idx').on(t.slug)],
);

export const publisherMembers = pgTable(
  'publisher_members',
  {
    publisherId: uuid('publisher_id')
      .notNull()
      .references(() => publishers.id, { onDelete: 'cascade' }),
    publisherAccountId: uuid('publisher_account_id')
      .notNull()
      .references(() => publisherAccounts.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.publisherId, t.publisherAccountId] })],
);

/** Pending (and accepted) email invites for publisher owner/editor membership. */
export const publisherInvites = pgTable(
  'publisher_invites',
  {
    id: id(),
    publisherId: uuid('publisher_id')
      .notNull()
      .references(() => publishers.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: memberRole('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedByAccountId: uuid('invited_by_account_id')
      .notNull()
      .references(() => publisherAccounts.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('publisher_invites_token_hash_idx').on(t.tokenHash),
    index('publisher_invites_publisher_id_idx').on(t.publisherId),
  ],
);

// ---------- events ----------
/**
 * Flat tags. The launch vocabulary is the Visit Söderhamn category tree under Evenemang.
 * `external_id` is the source key (`visit-soderhamn:30192`) so a later import updates the name.
 */
export const tags = pgTable('tags', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  externalId: text('external_id').unique(),
});

/**
 * Swedish municipality/county boundaries for region subscriptions.
 * Launch seed: Söderhamn kommun + Gävleborg län (simplified fixture polygons).
 */
export const regions = pgTable(
  'regions',
  {
    id: id(),
    name: text('name').notNull(),
    kind: regionKind('kind').notNull(),
    code: text('code').notNull(),
    boundary: geographyMultiPolygon('boundary').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('regions_code_idx').on(t.code),
    index('regions_boundary_gist').using('gist', t.boundary),
  ],
);

/** Tags the user wants nearby notifications for. */
export const userInterests = pgTable(
  'user_interests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tagId] }),
    index('user_interests_user_id_idx').on(t.userId),
  ],
);

/**
 * Saved notification/search areas. Circle = center + radius_m; drawn polygon = area;
 * region subscription copies `regions.boundary` into `area` and sets `region_id`.
 */
export const userAreas = pgTable(
  'user_areas',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: userAreaKind('kind').notNull().default('manual'),
    origin: userAreaOrigin('origin').notNull().default('manual'),
    regionId: uuid('region_id').references(() => regions.id, { onDelete: 'set null' }),
    area: geographyPolygon('area'),
    center: geographyPoint('center'),
    radiusM: integer('radius_m'),
    notify: boolean('notify').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('user_areas_user_id_idx').on(t.userId),
    index('user_areas_center_gist').using('gist', t.center),
    index('user_areas_area_gist').using('gist', t.area),
  ],
);

export const events = pgTable(
  'events',
  {
    id: id(),
    publisherId: uuid('publisher_id')
      .notNull()
      .references(() => publishers.id),
    title: text('title').notNull(),
    description: text('description'),
    mode: eventMode('mode').notNull(),
    status: eventStatus('status').notNull().default('draft'),
    origin: origin('origin').notNull().default('native'),
    sourceUrl: text('source_url'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull().default('Europe/Stockholm'),
    venueName: text('venue_name'),
    location: geographyPoint('location'),
    geofence: geographyPolygon('geofence'),
    geofenceRadiusM: integer('geofence_radius_m').default(100),
    onlineUrl: text('online_url'),
    /** Minor currency units (öre for SEK). Null means unknown; 0 means free. */
    priceAmount: integer('price_amount'),
    currency: text('currency').notNull().default('SEK'),
    /** Admin pick shown first on the home feed. Distinct from future paid placements. */
    featured: boolean('featured').notNull().default(false),
    /** Admin opt-in. When false, check-in and the text/links it unlocks are unavailable. */
    checkInEnabled: boolean('check_in_enabled').notNull().default(false),
    /** Extra text the publisher writes. Returned only after check-in. */
    attendeeText: text('attendee_text'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_location_gist').using('gist', t.location),
    index('events_status_starts_idx').on(t.status, t.startsAt),
  ],
);

export const eventTags = pgTable(
  'event_tags',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.tagId] }),
    index('event_tags_tag_id_idx').on(t.tagId),
  ],
);

/** One or more outbound links (tickets, registration, info) on an event. */
export const eventLinks = pgTable(
  'event_links',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    type: eventLinkType('type').notNull(),
    url: text('url').notNull(),
    label: text('label'),
    /** `attendees` links are hidden until check-in. Imports only replace `public` links. */
    audience: eventLinkAudience('audience').notNull().default('public'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('event_links_event_position_idx').on(t.eventId, t.position)],
);

/** Bookmarks. Distinct from subscriptions, which are notification follows. */
export const savedEvents = pgTable(
  'saved_events',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.eventId] }),
    index('saved_events_user_id_idx').on(t.userId),
  ],
);

export const eventLists = pgTable(
  'event_lists',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('event_lists_user_id_idx').on(t.userId)],
);

export const eventListItems = pgTable(
  'event_list_items',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => eventLists.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.eventId] }),
    index('event_list_items_event_id_idx').on(t.eventId),
  ],
);

/**
 * User follows for push: publisher (on publish) or event (on meaningful update).
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: subscriptionTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.targetType, t.targetId] }),
    index('subscriptions_user_id_idx').on(t.userId),
    index('subscriptions_target_idx').on(t.targetType, t.targetId),
  ],
);

/**
 * Attendance proof. Unique per (user, event). Geo first; code/QR later.
 */
export const checkIns = pgTable(
  'check_ins',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    method: checkInMethod('method').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    accuracyM: integer('accuracy_m'),
    deviceFlags: jsonb('device_flags').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('check_ins_user_event_idx').on(t.userId, t.eventId),
    index('check_ins_event_id_idx').on(t.eventId),
  ],
);

/**
 * Rotating check-in codes (venue QR + digital events). Secret never leaves the server;
 * attendees only see the current 6-char code / QR after the publisher starts the session.
 */
export const digitalCodes = pgTable('digital_codes', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  revealedAt: timestamp('revealed_at', { withTimezone: true }),
  /** Slot length in seconds (default 60). */
  rotationS: integer('rotation_s').notNull().default(60),
  createdAt: createdAt(),
});

export const ratings = pgTable(
  'ratings',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    comment: text('comment'),
    /** Soft-hide from public aggregates / publisher views after moderation. */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ratings_user_event_idx').on(t.userId, t.eventId),
    index('ratings_event_id_idx').on(t.eventId),
  ],
);

export const statsSourceType = pgEnum('stats_source_type', ['user', 'event', 'publisher']);

/**
 * Polymorphic counters. Historical buckets use key suffixes
 * (`numCheckins-2026-01-01`, `numCheckins-w01`, `numCheckins-2026-m01`, `numCheckins-2026`).
 */
export const stats = pgTable(
  'stats',
  {
    sourceType: statsSourceType('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    key: text('key').notNull(),
    value: doublePrecision('value').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceType, t.sourceId, t.key] }),
    index('stats_source_idx').on(t.sourceType, t.sourceId),
  ],
);

/**
 * Public event images in object storage. `s3_key` is the object key in the public
 * assets bucket (Garage locally, S3 behind CloudFront in AWS). `source_url` is the
 * upstream URL the importer copied, so an unchanged image is not downloaded again.
 */
export const eventImages = pgTable(
  'event_images',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** `main` is the hero. More roles can share this table. */
    role: text('role').notNull().default('main'),
    s3Key: text('s3_key').notNull(),
    sourceUrl: text('source_url'),
    contentType: text('content_type').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('event_images_event_role_idx').on(t.eventId, t.role)],
);

/** Maps, schedules, info and files — attendee visibility gated by check-in. */
export const eventContent = pgTable(
  'event_content',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    kind: eventContentKind('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Private S3 object key; signed URL minted at read time when present. */
    s3Key: text('s3_key'),
    visibility: eventContentVisibility('visibility').notNull().default('attendees'),
    createdAt: createdAt(),
  },
  (t) => [index('event_content_event_id_idx').on(t.eventId)],
);

/**
 * Notification inbox — every match is stored; unique (user, event, reason) for SQS retries.
 * Quiet hours + daily OS-notification cap are client-side. `sentAt` = inbox accept time;
 * silent Expo delivery is tracked via `pushState` / `pushedAt`. Rows older than 90 days
 * are purged by the worker.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    reason: notificationReason('reason').notNull(),
    /** Inbox accept time (daily-cap bucketing). Historical name; not “Expo sent”. */
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    pushState: notificationPushState('push_state').notNull().default('pending'),
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('notifications_user_event_reason_idx').on(t.userId, t.eventId, t.reason),
    index('notifications_user_sent_at_idx').on(t.userId, t.sentAt),
    index('notifications_push_state_idx').on(t.pushState, t.sentAt),
  ],
);

// ---------- ingestion ----------
export const dataSources = pgTable('data_sources', {
  id: id(),
  slug: text('slug').notNull().unique(),
  kind: sourceKind('kind').notNull(),
  schedule: text('schedule').notNull(), // cron expression for EventBridge Scheduler
  config: jsonb('config').notNull().default({}),
  trust: sourceTrust('trust').notNull().default('review'),
  enabled: boolean('enabled').notNull().default(false),
  createdAt: createdAt(),
});

export const ingestionRuns = pgTable('ingestion_runs', {
  id: id(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => dataSources.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'),
  fetched: integer('fetched').notNull().default(0),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  error: text('error'),
});

export const externalRefs = pgTable(
  'external_refs',
  {
    sourceId: uuid('source_id')
      .notNull()
      .references(() => dataSources.id),
    externalId: text('external_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.externalId] })],
);

export const publisherAliases = pgTable(
  'publisher_aliases',
  {
    sourceId: uuid('source_id')
      .notNull()
      .references(() => dataSources.id),
    externalOrganizerKey: text('external_organizer_key').notNull(),
    publisherId: uuid('publisher_id')
      .notNull()
      .references(() => publishers.id),
    mappedBy: uuid('mapped_by'),
    mappedAt: timestamp('mapped_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.externalOrganizerKey] })],
);

/**
 * Every admin write (and optionally source-run side effects).
 * `actor` is admin_users.id as text, or `system:<source>` for ingest.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);
