/**
 * Starter schema covering identity, publishers, events and ingestion.
 * The full model is in docs/project-description.md (Data model); add the remaining tables
 * (check-ins, ratings, subscriptions, notifications, stats, regions, ...) as each phase needs them.
 * Spatial indexes (GiST) are declared with `.using('gist', ...)`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { geographyPoint, geographyPolygon } from './postgis';

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

// ---------- identity ----------
export const users = pgTable('users', {
  id: id(),
  displayName: text('display_name'),
  isPublic: boolean('is_public').notNull().default(false),
  recoveryEmail: text('recovery_email'),
  recoveryEmailVerifiedAt: timestamp('recovery_email_verified_at', { withTimezone: true }),
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

// ---------- events ----------
export const categories = pgTable('categories', {
  id: id(),
  slug: text('slug').notNull().unique(),
  parentId: uuid('parent_id'),
  nameSv: text('name_sv').notNull(),
  nameEn: text('name_en').notNull(),
});

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
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_location_gist').using('gist', t.location),
    index('events_status_starts_idx').on(t.status, t.startsAt),
  ],
);

export const eventCategories = pgTable(
  'event_categories',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.categoryId] })],
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
