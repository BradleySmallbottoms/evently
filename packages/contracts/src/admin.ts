import { z } from 'zod';

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
