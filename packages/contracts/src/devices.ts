import { z } from 'zod';

export const RegisterPushTokenRequest = z.object({
  deviceCredential: z.string().min(1).max(512),
  /** Expo push token, e.g. ExponentPushToken[…] or ExpoPushToken[…]. */
  expoPushToken: z
    .string()
    .min(1)
    .max(512)
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/),
});
export type RegisterPushTokenRequest = z.infer<typeof RegisterPushTokenRequest>;

export const RegisterPushTokenResponse = z.object({
  ok: z.literal(true),
});
export type RegisterPushTokenResponse = z.infer<typeof RegisterPushTokenResponse>;
