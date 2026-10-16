import { z } from 'zod';
import {
  CurrencyCode,
  EventLink,
  EventLinkInput,
  EventMeta,
  HttpUrl,
  ImportNotificationPlan,
  PriceAmount,
} from './events';

const Id = z.uuid();

export const AdminLoginRequest = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequest>;

export const AdminLoginTotpRequired = z.object({
  status: z.literal('totp_required'),
  challengeToken: z.string().min(1),
});
export type AdminLoginTotpRequired = z.infer<typeof AdminLoginTotpRequired>;

export const AdminLoginTotpSetup = z.object({
  status: z.literal('totp_setup'),
  setupToken: z.string().min(1),
  otpauthUrl: z.string().min(1),
  /** Shown once so the admin can enroll without a camera; never stored client-side long-term. */
  secret: z.string().min(1),
});
export type AdminLoginTotpSetup = z.infer<typeof AdminLoginTotpSetup>;

export const AdminLoginChallengeResponse = z.discriminatedUnion('status', [
  AdminLoginTotpRequired,
  AdminLoginTotpSetup,
]);
export type AdminLoginChallengeResponse = z.infer<typeof AdminLoginChallengeResponse>;

export const AdminTotpConfirmRequest = z.object({
  token: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
export type AdminTotpConfirmRequest = z.infer<typeof AdminTotpConfirmRequest>;

export const AdminSessionResponse = z.object({
  adminId: Id,
  email: z.email(),
  role: z.string(),
  expiresAt: z.iso.datetime(),
});
export type AdminSessionResponse = z.infer<typeof AdminSessionResponse>;

/** Why the review queue marks an event. Empty means nothing looks off. */
export const AdminEventWarning = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('possible_duplicate'),
    eventId: Id,
    title: z.string(),
    matchedOn: z.enum(['title', 'event-link', 'link', 'id']),
  }),
]);
export type AdminEventWarning = z.infer<typeof AdminEventWarning>;

export const AdminEventReviewItem = z.object({
  id: Id,
  publisherId: Id,
  publisherName: z.string(),
  title: z.string(),
  mode: z.enum(['physical', 'digital']),
  status: z.literal('in_review'),
  origin: z.enum(['native', 'imported']),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  venueName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  warnings: z.array(AdminEventWarning),
  createdAt: z.iso.datetime(),
});
export type AdminEventReviewItem = z.infer<typeof AdminEventReviewItem>;

export const AdminEventReviewListResponse = z.object({
  items: z.array(AdminEventReviewItem),
});
export type AdminEventReviewListResponse = z.infer<typeof AdminEventReviewListResponse>;

export const AdminEventDecisionResponse = z.object({
  id: Id,
  status: z.enum(['published', 'cancelled']),
});
export type AdminEventDecisionResponse = z.infer<typeof AdminEventDecisionResponse>;

export const AdminEventDeleteResponse = z.object({
  id: Id,
});
export type AdminEventDeleteResponse = z.infer<typeof AdminEventDeleteResponse>;

export const AdminTemporaryPublisher = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  type: z.enum(['org', 'person']),
  origin: z.enum(['native', 'imported']),
  eventCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type AdminTemporaryPublisher = z.infer<typeof AdminTemporaryPublisher>;

export const AdminTemporaryPublisherListResponse = z.object({
  items: z.array(AdminTemporaryPublisher),
});
export type AdminTemporaryPublisherListResponse = z.infer<
  typeof AdminTemporaryPublisherListResponse
>;

export const AdminMapPublisherRequest = z.object({
  targetPublisherId: Id,
});
export type AdminMapPublisherRequest = z.infer<typeof AdminMapPublisherRequest>;

export const AdminMapPublisherResponse = z.object({
  id: Id,
  targetPublisherId: Id,
  movedEventCount: z.number().int().nonnegative(),
});
export type AdminMapPublisherResponse = z.infer<typeof AdminMapPublisherResponse>;

export const AdminCompletePublisherRequest = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  type: z.enum(['org', 'person']),
});
export type AdminCompletePublisherRequest = z.infer<typeof AdminCompletePublisherRequest>;

export const AdminCompletePublisherResponse = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  type: z.enum(['org', 'person']),
  isTemporary: z.literal(false),
});
export type AdminCompletePublisherResponse = z.infer<typeof AdminCompletePublisherResponse>;

export const AdminDataSource = z.object({
  id: Id,
  slug: z.string(),
  kind: z.enum(['api', 'feed', 'scraper']),
  schedule: z.string(),
  trust: z.enum(['auto_publish', 'review']),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AdminDataSource = z.infer<typeof AdminDataSource>;

export const AdminDataSourceListResponse = z.object({
  items: z.array(AdminDataSource),
});
export type AdminDataSourceListResponse = z.infer<typeof AdminDataSourceListResponse>;

export const AdminDataSourcePatchRequest = z.object({
  enabled: z.boolean().optional(),
});
export type AdminDataSourcePatchRequest = z.infer<typeof AdminDataSourcePatchRequest>;

export const AdminIngestionRun = z.object({
  id: Id,
  sourceId: Id,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.string(),
  fetched: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  error: z.string().nullable(),
});
export type AdminIngestionRun = z.infer<typeof AdminIngestionRun>;

export const AdminIngestionRunListResponse = z.object({
  items: z.array(AdminIngestionRun),
});
export type AdminIngestionRunListResponse = z.infer<typeof AdminIngestionRunListResponse>;

export const AdminDataSourceRunResponse = z.object({
  started: z.boolean(),
  mode: z.enum(['local_spawn', 'ecs', 'unavailable']),
  message: z.string(),
});
export type AdminDataSourceRunResponse = z.infer<typeof AdminDataSourceRunResponse>;

export const AdminAuditLogEntry = z.object({
  id: Id,
  actor: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  at: z.iso.datetime(),
});
export type AdminAuditLogEntry = z.infer<typeof AdminAuditLogEntry>;

export const AdminAuditLogListResponse = z.object({
  items: z.array(AdminAuditLogEntry),
});
export type AdminAuditLogListResponse = z.infer<typeof AdminAuditLogListResponse>;

export const AdminUserSummary = z.object({
  id: Id,
  displayName: z.string().nullable(),
  recoveryEmail: z.string().nullable(),
  isPublic: z.boolean(),
  bannedAt: z.iso.datetime().nullable(),
  banReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummary>;

export const AdminUserListResponse = z.object({
  items: z.array(AdminUserSummary),
});
export type AdminUserListResponse = z.infer<typeof AdminUserListResponse>;

export const AdminBanUserRequest = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type AdminBanUserRequest = z.infer<typeof AdminBanUserRequest>;

export const AdminRatingModerationItem = z.object({
  id: Id,
  userId: Id,
  eventId: Id,
  eventTitle: z.string(),
  score: z.number().int(),
  comment: z.string().nullable(),
  hiddenAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminRatingModerationItem = z.infer<typeof AdminRatingModerationItem>;

export const AdminRatingModerationListResponse = z.object({
  items: z.array(AdminRatingModerationItem),
});
export type AdminRatingModerationListResponse = z.infer<typeof AdminRatingModerationListResponse>;

export const AdminSuspiciousCheckIn = z.object({
  id: Id,
  userId: Id,
  eventId: Id,
  eventTitle: z.string(),
  method: z.enum(['geo', 'code']),
  accuracyM: z.number().int().nullable(),
  deviceFlags: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AdminSuspiciousCheckIn = z.infer<typeof AdminSuspiciousCheckIn>;

export const AdminSuspiciousCheckInListResponse = z.object({
  items: z.array(AdminSuspiciousCheckIn),
});
export type AdminSuspiciousCheckInListResponse = z.infer<typeof AdminSuspiciousCheckInListResponse>;

export const AdminEventReportItem = z.object({
  id: Id,
  userId: Id,
  eventId: Id,
  eventTitle: z.string(),
  createdAt: z.iso.datetime(),
});
export type AdminEventReportItem = z.infer<typeof AdminEventReportItem>;

export const AdminEventReportListResponse = z.object({
  items: z.array(AdminEventReportItem),
});
export type AdminEventReportListResponse = z.infer<typeof AdminEventReportListResponse>;

export const AdminEventListItem = z.object({
  id: Id,
  publisherId: Id,
  publisherName: z.string(),
  title: z.string(),
  mode: z.enum(['physical', 'digital']),
  status: z.enum([
    'draft',
    'awaiting_verification',
    'pending_scan',
    'in_review',
    'published',
    'cancelled',
    'ended',
  ]),
  origin: z.enum(['native', 'imported']),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  venueName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  featured: z.boolean(),
  checkInEnabled: z.boolean(),
  warnings: z.array(AdminEventWarning),
  createdAt: z.iso.datetime(),
});
export type AdminEventListItem = z.infer<typeof AdminEventListItem>;

export const AdminEventListQuery = z.object({
  status: AdminEventListItem.shape.status.optional(),
  /** Matches title, venue, or publisher name. */
  q: z.string().trim().min(1).max(200).optional(),
  /** `starts` is newest start time first. `created` is oldest created first. */
  sort: z.enum(['starts', 'created']).optional().default('starts'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(100_000).optional().default(0),
});
export type AdminEventListQuery = z.infer<typeof AdminEventListQuery>;

export const AdminEventListResponse = z.object({
  items: z.array(AdminEventListItem),
  total: z.number().int().nonnegative(),
  /** Pass as `offset` to load the next page. Null on the last page. */
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type AdminEventListResponse = z.infer<typeof AdminEventListResponse>;

export const AdminEventDetail = AdminEventListItem.extend({
  description: z.string().nullable(),
  timezone: z.string(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .nullable(),
  geofenceRadiusM: z.number().int().nullable(),
  onlineUrl: z.string().nullable(),
  priceAmount: z.number().int().nonnegative().nullable(),
  currency: z.string(),
  meta: EventMeta,
    sourceUrl: z.string().nullable(),
    /** Source event id. Null on a native event. */
    refId: z.string().nullable(),
    /** Data-worker slug. Null on a native event. */
    workerId: z.string().nullable(),
    tagIds: z.array(Id),
  links: z.array(EventLink),
  /** Hero image. Null when the event has none or the public asset host is unset. */
  imageUrl: z.url().nullable(),
  /** Photos after the hero, `gallery-1` then `gallery-2`, and so on. */
  imageUrls: z.array(z.url()),
  updatedAt: z.iso.datetime(),
});
export type AdminEventDetail = z.infer<typeof AdminEventDetail>;

const AdminEventStatus = z.enum([
  'draft',
  'awaiting_verification',
  'in_review',
  'published',
  'cancelled',
  'ended',
]);

export const AdminEventPatchRequest = z
  .object({
    title: z.string().trim().min(1).max(2000).optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    mode: z.enum(['physical', 'digital']).optional(),
    status: AdminEventStatus.optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    venueName: z.string().trim().max(200).nullable().optional(),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .nullable()
      .optional(),
    geofenceRadiusM: z.number().int().min(10).max(5000).nullable().optional(),
    onlineUrl: HttpUrl.nullable().optional(),
    priceAmount: PriceAmount.nullable().optional(),
    currency: CurrencyCode.optional(),
    links: z.array(EventLinkInput).max(10).optional(),
    tagIds: z.array(Id).max(20).optional(),
    featured: z.boolean().optional(),
    checkInEnabled: z.boolean().optional(),
  })
  .refine(
    (body) => {
      if (body.startsAt && body.endsAt) return new Date(body.endsAt) > new Date(body.startsAt);
      return true;
    },
    { message: 'endsAt must be after startsAt', path: ['endsAt'] },
  );
export type AdminEventPatchRequest = z.infer<typeof AdminEventPatchRequest>;

export const AdminPublisherPatchRequest = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  type: z.enum(['org', 'person']).optional(),
  importNotificationPlan: ImportNotificationPlan.nullable().optional(),
});
export type AdminPublisherPatchRequest = z.infer<typeof AdminPublisherPatchRequest>;
