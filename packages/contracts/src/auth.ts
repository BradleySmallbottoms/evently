import { z } from 'zod';
import { PublisherStatus } from './events';

// Local mirrors of shared primitives to avoid a circular import with ./index.
const Id = z.uuid();
const Locale = z.enum(['sv', 'en']);

export const DevicePlatform = z.enum(['ios', 'android', 'web']);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const CreateIdentityRequest = z.object({
  platform: DevicePlatform,
  locale: Locale.optional().default('sv'),
});
export type CreateIdentityRequest = z.infer<typeof CreateIdentityRequest>;

export const CreateIdentityResponse = z.object({
  userId: Id,
  deviceId: Id,
  deviceCredential: z.string().min(1),
  sessionToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type CreateIdentityResponse = z.infer<typeof CreateIdentityResponse>;

export const CreateSessionRequest = z.object({
  deviceCredential: z.string().min(1),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const CreateSessionResponse = z.object({
  userId: Id,
  sessionToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

export const PublisherType = z.enum(['org', 'person']);
export type PublisherType = z.infer<typeof PublisherType>;

export const RegisterPublisherRequest = z.object({
  email: z.email(),
  password: z.string().min(10).max(200),
  name: z.string().trim().min(2).max(120),
  type: PublisherType,
  slug: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
});
export type RegisterPublisherRequest = z.infer<typeof RegisterPublisherRequest>;

export const RegisterPublisherResponse = z.object({
  publisherAccountId: Id,
  publisherId: Id,
  email: z.email(),
  /** Present only outside production so local/dev can verify without SES. */
  verificationToken: z.string().optional(),
});
export type RegisterPublisherResponse = z.infer<typeof RegisterPublisherResponse>;

export const VerifyPublisherEmailRequest = z.object({
  token: z.string().min(1),
});
export type VerifyPublisherEmailRequest = z.infer<typeof VerifyPublisherEmailRequest>;

export const VerifyPublisherEmailResponse = z.object({
  ok: z.literal(true),
});
export type VerifyPublisherEmailResponse = z.infer<typeof VerifyPublisherEmailResponse>;

export const LoginPublisherRequest = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});
export type LoginPublisherRequest = z.infer<typeof LoginPublisherRequest>;

export const PublisherSummary = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  type: PublisherType,
  status: PublisherStatus,
  role: z.enum(['owner', 'editor']),
});
export type PublisherSummary = z.infer<typeof PublisherSummary>;

export const LoginPublisherResponse = z.object({
  publisherAccountId: Id,
  email: z.email(),
  publishers: z.array(PublisherSummary),
});
export type LoginPublisherResponse = z.infer<typeof LoginPublisherResponse>;

export const PublisherMeResponse = LoginPublisherResponse;
export type PublisherMeResponse = z.infer<typeof PublisherMeResponse>;

export const MemberRole = z.enum(['owner', 'editor']);
export type MemberRole = z.infer<typeof MemberRole>;

export const PublisherProfile = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  type: PublisherType,
  status: PublisherStatus,
  origin: z.enum(['native', 'imported']),
  role: MemberRole.optional(),
});
export type PublisherProfile = z.infer<typeof PublisherProfile>;

export const UpdatePublisherProfileRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  type: PublisherType.optional(),
});
export type UpdatePublisherProfileRequest = z.infer<typeof UpdatePublisherProfileRequest>;

export const PublisherMember = z.object({
  publisherAccountId: Id,
  email: z.email(),
  role: MemberRole,
  createdAt: z.iso.datetime(),
});
export type PublisherMember = z.infer<typeof PublisherMember>;

export const PublisherMemberListResponse = z.object({
  items: z.array(PublisherMember),
});
export type PublisherMemberListResponse = z.infer<typeof PublisherMemberListResponse>;

export const CreatePublisherInviteRequest = z.object({
  email: z.email(),
  role: MemberRole,
});
export type CreatePublisherInviteRequest = z.infer<typeof CreatePublisherInviteRequest>;

export const CreatePublisherInviteResponse = z.object({
  id: Id,
  email: z.email(),
  role: MemberRole,
  expiresAt: z.iso.datetime(),
  /** Present only outside production so local/dev can accept without SES. */
  inviteToken: z.string().optional(),
});
export type CreatePublisherInviteResponse = z.infer<typeof CreatePublisherInviteResponse>;

export const PublisherInvite = z.object({
  id: Id,
  email: z.email(),
  role: MemberRole,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type PublisherInvite = z.infer<typeof PublisherInvite>;

export const PublisherInviteListResponse = z.object({
  items: z.array(PublisherInvite),
});
export type PublisherInviteListResponse = z.infer<typeof PublisherInviteListResponse>;

export const AcceptPublisherInviteRequest = z.object({
  token: z.string().min(1),
});
export type AcceptPublisherInviteRequest = z.infer<typeof AcceptPublisherInviteRequest>;

export const AcceptPublisherInviteResponse = z.object({
  publisherId: Id,
  role: MemberRole,
});
export type AcceptPublisherInviteResponse = z.infer<typeof AcceptPublisherInviteResponse>;

export const CreateWebLoginCodeRequest = z.object({
  deviceCredential: z.string().min(1),
});
export type CreateWebLoginCodeRequest = z.infer<typeof CreateWebLoginCodeRequest>;

export const CreateWebLoginCodeResponse = z.object({
  code: z.string().min(4),
  expiresAt: z.iso.datetime(),
});
export type CreateWebLoginCodeResponse = z.infer<typeof CreateWebLoginCodeResponse>;

export const ExchangeWebLoginCodeRequest = z.object({
  code: z.string().min(4),
});
export type ExchangeWebLoginCodeRequest = z.infer<typeof ExchangeWebLoginCodeRequest>;

export const ExchangeWebLoginCodeResponse = z.object({
  userId: Id,
  expiresAt: z.iso.datetime(),
});
export type ExchangeWebLoginCodeResponse = z.infer<typeof ExchangeWebLoginCodeResponse>;

export const WebUserMeResponse = z.object({
  userId: Id,
});
export type WebUserMeResponse = z.infer<typeof WebUserMeResponse>;

/** New phone: create a short-lived code for an already-signed-in device to confirm. */
export const CreateDeviceLinkCodeRequest = z.object({
  deviceCredential: z.string().min(1),
});
export type CreateDeviceLinkCodeRequest = z.infer<typeof CreateDeviceLinkCodeRequest>;

export const CreateDeviceLinkCodeResponse = z.object({
  code: z.string().min(4),
  expiresAt: z.iso.datetime(),
});
export type CreateDeviceLinkCodeResponse = z.infer<typeof CreateDeviceLinkCodeResponse>;

/** Old phone: confirm a device-link code and attach the new device to this user. */
export const ConfirmDeviceLinkRequest = z.object({
  deviceCredential: z.string().min(1),
  code: z.string().min(4),
});
export type ConfirmDeviceLinkRequest = z.infer<typeof ConfirmDeviceLinkRequest>;

export const ConfirmDeviceLinkResponse = z.object({
  userId: Id,
});
export type ConfirmDeviceLinkResponse = z.infer<typeof ConfirmDeviceLinkResponse>;
